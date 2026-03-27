const fallbackExchangeInfo = require("../fallback-perps.js");
const { insertSignalEvent, insertTradeEvent } = require("./neon-db");

const DEFAULT_TOKEN = "BTC";
const STRATEGY_INTERVAL = "1h";
const QUOTE_ASSET = "USDT";
const DEFAULT_QUALITY_THRESHOLD = 62;
const PRIORITY_SCAN_COUNT = 12;
const ROTATION_SCAN_COUNT = 20;
const ANALYSIS_CONCURRENCY = 5;
const TRADEZ_AUTO_START_BALANCE = 1000;
const TRADEZ_AUTO_LEVERAGE = 5;
const TRADEZ_AUTO_MAX_CONCURRENT_TRADES = 30;
const TRADEZ_AUTO_MAX_NEW_TRADES = 12;
const TRADEZ_AUTO_VERSION = 5;
const TRADEZ_AUTO_TRADE_COOLDOWN_MS = 4 * 60 * 1000;
const HIGHER_TIMEFRAME_INTERVAL = "4h";
const EMA_SLOPE_LOOKBACK = 4;
const MIN_EMA_SEPARATION_ATR = 0.2;
const MAX_STALE_SIGNAL_BARS = 6;
const MAX_AUTO_ENTRY_SIGNAL_BARS = 5;
const MAX_POST_TOUCH_EXTENSION_ATR = 3.0;
const MIN_VISIBLE_SIGNAL_RR = 1.2;
const MIN_EXECUTION_RR = 1.2;
const MIN_VISIBLE_SIGNAL_VOLUME_FACTOR = 1.0;
const MIN_AUTO_EXECUTION_VOLUME_FACTOR = 0.95;
const STRICT_LEVEL_TOUCH_BUFFER_ATR = 0.05;
const STRICT_LEVEL_RECLAIM_BUFFER_ATR = 0.04;
const MAX_EXECUTION_DISTANCE_FROM_TOUCH_ATR = 1.2;
const LIVE_ENTRY_BUFFER_ATR = 0.7;
const TRADEZ_AUTO_EXECUTION_THRESHOLD_BUFFER = 0;
const TRADEZ_AUTO_MIN_EXECUTION_THRESHOLD = 66;
const UTC_DAY_MS = 24 * 60 * 60 * 1000;

let exchangeInfoCache = null;
let perpUniverseCache = null;
let universeTickerMap = new Map();

function defaultRuntimeState() {
  return {
    startingBalance: TRADEZ_AUTO_START_BALANCE,
    balance: TRADEZ_AUTO_START_BALANCE,
    autoEnabled: true,
    openTrades: [],
    closedTrades: [],
    demoOrders: [],
    activity: [],
    activeTab: "positions",
    lastScanAt: 0,
    lastDailyBriefingUtcDate: utcDayKey(Date.now() - UTC_DAY_MS),
    strategyVersion: TRADEZ_AUTO_VERSION,
    qualityThreshold: DEFAULT_QUALITY_THRESHOLD,
    lastCandidates: [],
    scanCursor: 0,
    lastStatusMessage: "Background Auto Trade 2 engine is standing by.",
    lastStatusTone: "neutral",
    backgroundManaged: true,
  };
}

function sanitizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeActivityEntry(entry = {}) {
  return {
    time: sanitizeNumber(entry.time, Date.now()),
    message: String(entry.message || "").slice(0, 400),
    tone: entry.tone === "up" || entry.tone === "down" ? entry.tone : "neutral",
  };
}

function sanitizeDemoOrder(order = {}) {
  return {
    id: String(order.id || "").slice(0, 120),
    createdAt: sanitizeNumber(order.createdAt, Date.now()),
    detectedAt: sanitizeNumber(order.detectedAt, 0),
    symbol: String(order.symbol || "").trim(),
    side: order.side === "Short" ? "Short" : "Long",
    touch: String(order.touch || "").slice(0, 120),
    qualityScore: sanitizeNumber(order.qualityScore),
    leverage: sanitizeNumber(order.leverage, TRADEZ_AUTO_LEVERAGE),
    quantity: sanitizeNumber(order.quantity),
    status: String(order.status || "WATCHING").slice(0, 40),
    pricePrecision: Number.isInteger(Number(order.pricePrecision)) ? Number(order.pricePrecision) : 2,
    entryPrice: sanitizeNumber(order.entryPrice),
    tp1: sanitizeNumber(order.tp1),
    tp2: sanitizeNumber(order.tp2),
    stopLoss: sanitizeNumber(order.stopLoss),
    executionMode: String(order.executionMode || "demo").slice(0, 40),
    warnings: Array.isArray(order.warnings) ? order.warnings.map((item) => String(item).slice(0, 200)) : [],
    error: String(order.error || "").slice(0, 400),
  };
}

function sanitizeTrade(trade = {}) {
  return {
    id: String(trade.id || "").slice(0, 160),
    strategyLabel: String(trade.strategyLabel || "Auto Trade 2").slice(0, 80),
    symbol: String(trade.symbol || "").trim(),
    token: String(trade.token || "").trim(),
    side: trade.side === "Short" ? "Short" : "Long",
    touch: String(trade.touch || "").slice(0, 120),
    strength: String(trade.strength || "").slice(0, 80),
    entryPrice: sanitizeNumber(trade.entryPrice),
    entryZoneLow: sanitizeNumber(trade.entryZoneLow),
    entryZoneHigh: sanitizeNumber(trade.entryZoneHigh),
    stopLoss: sanitizeNumber(trade.stopLoss),
    tp1: sanitizeNumber(trade.tp1),
    tp2: sanitizeNumber(trade.tp2),
    currentTarget: sanitizeNumber(trade.currentTarget, sanitizeNumber(trade.tp1)),
    tp1Hit: Boolean(trade.tp1Hit),
    quantity: sanitizeNumber(trade.quantity),
    leverage: sanitizeNumber(trade.leverage, TRADEZ_AUTO_LEVERAGE),
    marginUsed: sanitizeNumber(trade.marginUsed),
    qualityScore: sanitizeNumber(trade.qualityScore),
    rr: sanitizeNumber(trade.rr),
    entryReason: String(trade.entryReason || "").slice(0, 300),
    keyDetails: String(trade.keyDetails || "").slice(0, 400),
    signalNote: String(trade.signalNote || "").slice(0, 300),
    pricePrecision: Number.isInteger(Number(trade.pricePrecision)) ? Number(trade.pricePrecision) : 2,
    detectedAt: sanitizeNumber(trade.detectedAt, Date.now()),
    openedAt: sanitizeNumber(trade.openedAt, Date.now()),
    lastPrice: sanitizeNumber(trade.lastPrice, sanitizeNumber(trade.entryPrice)),
    breakEvenArmed: Boolean(trade.breakEvenArmed),
    executionMode: String(trade.executionMode || "demo").slice(0, 40),
    exitPrice: Number.isFinite(Number(trade.exitPrice)) ? Number(trade.exitPrice) : undefined,
    closedAt: Number.isFinite(Number(trade.closedAt)) ? Number(trade.closedAt) : undefined,
    reason: trade.reason ? String(trade.reason).slice(0, 40) : undefined,
    pnlUsd: Number.isFinite(Number(trade.pnlUsd)) ? Number(trade.pnlUsd) : undefined,
    returnPct: Number.isFinite(Number(trade.returnPct)) ? Number(trade.returnPct) : undefined,
    balanceAfter: Number.isFinite(Number(trade.balanceAfter)) ? Number(trade.balanceAfter) : undefined,
  };
}

function sanitizeSignal(signal = {}) {
  return {
    id: String(signal.id || "").slice(0, 160),
    time: sanitizeNumber(signal.time),
    detectedAt: sanitizeNumber(signal.detectedAt),
    symbol: String(signal.symbol || "").trim(),
    token: String(signal.token || "").trim(),
    side: signal.side === "Short" ? "Short" : "Long",
    tone: signal.tone === "down" ? "down" : "up",
    touch: String(signal.touch || "").slice(0, 120),
    strength: String(signal.strength || "").slice(0, 80),
    levelTag: String(signal.levelTag || "").slice(0, 20),
    testedLevel: sanitizeNumber(signal.testedLevel),
    qualityScore: sanitizeNumber(signal.qualityScore),
    entryLow: sanitizeNumber(signal.entryLow),
    entryHigh: sanitizeNumber(signal.entryHigh),
    stopLoss: sanitizeNumber(signal.stopLoss),
    tp1: sanitizeNumber(signal.tp1),
    tp2: sanitizeNumber(signal.tp2),
    rr: sanitizeNumber(signal.rr),
    sinceTouchBars: sanitizeNumber(signal.sinceTouchBars),
    recentDistancePct: sanitizeNumber(signal.recentDistancePct),
    retestCount: sanitizeNumber(signal.retestCount),
    flowConfirmations: sanitizeNumber(signal.flowConfirmations),
    wickRejected: Boolean(signal.wickRejected),
    emaSeparationAtr: sanitizeNumber(signal.emaSeparationAtr),
    higherTimeframeConfirmed: Boolean(signal.higherTimeframeConfirmed),
    extensionFromTouch: sanitizeNumber(signal.extensionFromTouch),
    executionDistanceFromTouch: sanitizeNumber(signal.executionDistanceFromTouch),
    volumeFactor: sanitizeNumber(signal.volumeFactor, 1),
    moveStopToEntryAfterTp1: Boolean(signal.moveStopToEntryAfterTp1),
    note: String(signal.note || "").slice(0, 300),
    reasonParts: Array.isArray(signal.reasonParts) ? signal.reasonParts.map((part) => String(part).slice(0, 120)) : [],
  };
}

function sanitizeCandidate(candidate = {}) {
  return {
    symbol: String(candidate.symbol || "").trim(),
    token: String(candidate.token || "").trim(),
    pricePrecision: Number.isInteger(Number(candidate.pricePrecision)) ? Number(candidate.pricePrecision) : 2,
    currentPrice: sanitizeNumber(candidate.currentPrice),
    change24h: sanitizeNumber(candidate.change24h),
    latestEma20: sanitizeNumber(candidate.latestEma20),
    latestEma50: sanitizeNumber(candidate.latestEma50),
    latestRsi: sanitizeNumber(candidate.latestRsi, 50),
    latestAtr: sanitizeNumber(candidate.latestAtr),
    latestVolume: sanitizeNumber(candidate.latestVolume),
    oiChange1h: sanitizeNumber(candidate.oiChange1h),
    fundingRate: sanitizeNumber(candidate.fundingRate),
    qualityScore: sanitizeNumber(candidate.qualityScore),
    identifiedAt: sanitizeNumber(candidate.identifiedAt),
    setupBias: {
      label: String(candidate.setupBias?.label || "Balanced").slice(0, 80),
      tone:
        candidate.setupBias?.tone === "up" || candidate.setupBias?.tone === "down"
          ? candidate.setupBias.tone
          : "neutral",
      summary: String(candidate.setupBias?.summary || "").slice(0, 240),
    },
    tradeSummary: {
      cvdSlope: sanitizeNumber(candidate.tradeSummary?.cvdSlope),
    },
    depthSummary: {
      imbalance: sanitizeNumber(candidate.depthSummary?.imbalance),
      spreadBps: sanitizeNumber(candidate.depthSummary?.spreadBps),
    },
    takerSummary: {
      latestRatio: sanitizeNumber(candidate.takerSummary?.latestRatio, 1),
    },
    supportResistance: {
      supportLevels: Array.isArray(candidate.supportResistance?.supportLevels)
        ? candidate.supportResistance.supportLevels.map((value) => sanitizeNumber(value)).filter(Number.isFinite)
        : [],
      resistanceLevels: Array.isArray(candidate.supportResistance?.resistanceLevels)
        ? candidate.supportResistance.resistanceLevels.map((value) => sanitizeNumber(value)).filter(Number.isFinite)
        : [],
      bandWidth: sanitizeNumber(candidate.supportResistance?.bandWidth),
    },
    activeSignal: candidate.activeSignal ? sanitizeSignal(candidate.activeSignal) : null,
    markers: Array.isArray(candidate.markers) ? candidate.markers.slice(-12) : [],
    historicalSignals: Array.isArray(candidate.historicalSignals)
      ? candidate.historicalSignals.slice(-10).map(sanitizeSignal)
      : [],
  };
}

function sanitizeRuntimeState(rawState = {}) {
  const base = defaultRuntimeState();
  const sanitized = {
    startingBalance: sanitizeNumber(rawState.startingBalance, base.startingBalance),
    balance: sanitizeNumber(rawState.balance, base.balance),
    autoEnabled: rawState.autoEnabled !== false,
    openTrades: Array.isArray(rawState.openTrades) ? rawState.openTrades.map(sanitizeTrade) : [],
    closedTrades: Array.isArray(rawState.closedTrades) ? rawState.closedTrades.map(sanitizeTrade).slice(0, 100) : [],
    demoOrders: Array.isArray(rawState.demoOrders) ? rawState.demoOrders.map(sanitizeDemoOrder).slice(0, 80) : [],
    activity: Array.isArray(rawState.activity) ? rawState.activity.map(sanitizeActivityEntry).slice(0, 30) : [],
    activeTab: rawState.activeTab || base.activeTab,
    lastScanAt: sanitizeNumber(rawState.lastScanAt, 0),
    lastDailyBriefingUtcDate: rawState.lastDailyBriefingUtcDate || base.lastDailyBriefingUtcDate,
    strategyVersion: sanitizeNumber(rawState.strategyVersion, TRADEZ_AUTO_VERSION),
    qualityThreshold: Math.max(50, sanitizeNumber(rawState.qualityThreshold, base.qualityThreshold)),
    lastCandidates: Array.isArray(rawState.lastCandidates)
      ? rawState.lastCandidates.map(sanitizeCandidate).slice(0, 48)
      : [],
    scanCursor: Math.max(0, sanitizeNumber(rawState.scanCursor, 0)),
    lastStatusMessage: String(rawState.lastStatusMessage || base.lastStatusMessage).slice(0, 400),
    lastStatusTone:
      rawState.lastStatusTone === "up" || rawState.lastStatusTone === "down"
        ? rawState.lastStatusTone
        : "neutral",
    backgroundManaged: true,
  };
  normalizeTradezResearchBook(sanitized);
  return sanitized;
}

function buildResetRuntimeState() {
  return defaultRuntimeState();
}

function applyRuntimeSettings(currentState, patch = {}) {
  const next = sanitizeRuntimeState({
    ...currentState,
    autoEnabled: patch.autoEnabled ?? currentState.autoEnabled,
    qualityThreshold:
      patch.qualityThreshold === undefined ? currentState.qualityThreshold : patch.qualityThreshold,
    activeTab: patch.activeTab || currentState.activeTab,
  });
  next.lastStatusMessage =
    patch.statusMessage || currentState.lastStatusMessage || "Background Auto Trade 2 engine updated.";
  next.lastStatusTone = patch.statusTone || currentState.lastStatusTone || "neutral";
  return next;
}

function inferTradezLegacyBookBaseline(book) {
  const startingBalance = Number(book?.startingBalance);
  const balance = Number(book?.balance);
  if (Number.isFinite(startingBalance) && startingBalance > 0 && startingBalance < TRADEZ_AUTO_START_BALANCE) {
    return startingBalance;
  }
  if (
    Number.isFinite(startingBalance) &&
    startingBalance >= TRADEZ_AUTO_START_BALANCE &&
    Number.isFinite(balance) &&
    balance > 0 &&
    balance < TRADEZ_AUTO_START_BALANCE * 0.2
  ) {
    return 200;
  }
  return null;
}

function normalizeTradezResearchBook(book) {
  const legacyBaseline = inferTradezLegacyBookBaseline(book);
  const storedStarting = Number(book?.startingBalance) || legacyBaseline || TRADEZ_AUTO_START_BALANCE;
  const storedBalance = Number(book?.balance);
  const realizedDelta = Number.isFinite(storedBalance) ? storedBalance - storedStarting : 0;

  if (storedStarting !== TRADEZ_AUTO_START_BALANCE) {
    book.startingBalance = TRADEZ_AUTO_START_BALANCE;
    book.balance = TRADEZ_AUTO_START_BALANCE + realizedDelta;
  } else if (!Number.isFinite(storedBalance)) {
    book.balance = TRADEZ_AUTO_START_BALANCE;
  }

  if (!book.lastDailyBriefingUtcDate) {
    book.lastDailyBriefingUtcDate = utcDayKey(Date.now() - UTC_DAY_MS);
  }

  if ((Number(book.strategyVersion) || 1) < TRADEZ_AUTO_VERSION) {
    book.strategyVersion = TRADEZ_AUTO_VERSION;
  }
}

function utcDayKey(timestamp = Date.now()) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) return new Date().toISOString().slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function logActivity(state, message, tone = "neutral") {
  state.activity.unshift({
    time: Date.now(),
    message,
    tone,
  });
  state.activity = state.activity.slice(0, 30);
}

function setRuntimeStatus(state, message, tone = "neutral") {
  state.lastStatusMessage = String(message || "").slice(0, 400);
  state.lastStatusTone = tone === "up" || tone === "down" ? tone : "neutral";
}

function getFallbackExchangeInfo() {
  if (!fallbackExchangeInfo || !Array.isArray(fallbackExchangeInfo.symbols) || !fallbackExchangeInfo.symbols.length) {
    return null;
  }
  return fallbackExchangeInfo;
}

function normalizeToken(rawToken) {
  const cleaned = String(rawToken || "")
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return DEFAULT_TOKEN;
  if (cleaned.endsWith(QUOTE_ASSET)) return cleaned.slice(0, -QUOTE_ASSET.length) || DEFAULT_TOKEN;
  return cleaned;
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

function perpUniverseSymbols(exchangeInfo) {
  return (exchangeInfo.symbols || []).filter(
    (symbolInfo) =>
      symbolInfo.quoteAsset === QUOTE_ASSET &&
      symbolInfo.contractType === "PERPETUAL" &&
      symbolInfo.status === "TRADING"
  );
}

function resolvePerpSymbol(rawToken, exchangeInfo) {
  const cleanedToken = normalizeToken(rawToken);
  const ranked = perpUniverseSymbols(exchangeInfo)
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
  if (!resolved) throw new Error(`No USDT perpetual contract found for "${cleanedToken}".`);
  return {
    cleanedToken,
    symbol: resolved.symbol,
    baseAsset: resolved.baseAsset,
    pricePrecision: resolved.pricePrecision,
  };
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

function hasGoodTradingVolume(quoteVolume) {
  return Number(quoteVolume) >= 50_000_000;
}

function priceDigits(value, precisionHint = 2) {
  if (!Number.isFinite(value)) return Math.min(Math.max(precisionHint, 2), 8);
  if (value >= 1000) return 2;
  if (value >= 1) return Math.min(Math.max(precisionHint, 2), 4);
  return Math.min(Math.max(precisionHint, 4), 8);
}

function formatPrice(value, precisionHint = 2) {
  if (!Number.isFinite(value)) return "-";
  return `$${Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: priceDigits(value, precisionHint),
  })}`;
}

function formatPercent(value, digits = 2) {
  if (!Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatCompactUsd(value, digits = 2) {
  if (!Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : "-"}$${new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: digits,
  }).format(Math.abs(value))}`;
}

function ema(values, period) {
  const multiplier = 2 / (period + 1);
  const result = [];
  let previous = null;
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      result.push(null);
      return;
    }
    if (index < period - 1) {
      result.push(null);
      return;
    }
    if (index === period - 1) {
      previous = average(values.slice(0, period));
      result.push(previous);
      return;
    }
    previous = (value - previous) * multiplier + previous;
    result.push(previous);
  });
  return result;
}

function rsi(values, period = 14) {
  const output = new Array(values.length).fill(null);
  if (values.length <= period) return output;
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const delta = values[index] - values[index - 1];
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  output[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let index = period + 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    output[index] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return output;
}

function atr(candles, period = 14) {
  const output = new Array(candles.length).fill(null);
  if (candles.length <= period) return output;
  const trueRanges = candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const previousClose = candles[index - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose)
    );
  });
  const initialAverage = average(trueRanges.slice(1, period + 1));
  output[period] = initialAverage;
  let previous = initialAverage;
  for (let index = period + 1; index < trueRanges.length; index += 1) {
    previous = (previous * (period - 1) + trueRanges[index]) / period;
    output[index] = previous;
  }
  return output;
}

function computeSupportResistance(candles, currentPrice, latestAtr) {
  const pivotsHigh = [];
  const pivotsLow = [];
  for (let index = 2; index < candles.length - 2; index += 1) {
    const candle = candles[index];
    const previous1 = candles[index - 1];
    const previous2 = candles[index - 2];
    const next1 = candles[index + 1];
    const next2 = candles[index + 2];
    if (candle.high > previous1.high && candle.high > previous2.high && candle.high > next1.high && candle.high > next2.high) {
      pivotsHigh.push(candle.high);
    }
    if (candle.low < previous1.low && candle.low < previous2.low && candle.low < next1.low && candle.low < next2.low) {
      pivotsLow.push(candle.low);
    }
  }
  const bandWidth = Math.max(latestAtr * 0.35, currentPrice * 0.0025);
  const supports = pivotsLow
    .filter((level) => level < currentPrice)
    .sort((left, right) => right - left)
    .slice(0, 2);
  const resistances = pivotsHigh
    .filter((level) => level > currentPrice)
    .sort((left, right) => left - right)
    .slice(0, 2);
  return {
    supportLevels: supports,
    resistanceLevels: resistances,
    bandWidth,
  };
}

function analyzeTradeTape(trades) {
  const parsed = (trades || []).map((trade) => ({
    qty: Number(trade.q || trade.qty || trade.quantity),
    price: Number(trade.p || trade.price),
    isBuyerMaker: Boolean(trade.m),
  }));
  let buyVolume = 0;
  let sellVolume = 0;
  parsed.forEach((trade) => {
    const volume = (trade.qty || 0) * (trade.price || 0);
    if (trade.isBuyerMaker) sellVolume += volume;
    else buyVolume += volume;
  });
  const denominator = buyVolume + sellVolume;
  return {
    buyVolume,
    sellVolume,
    cvdSlope: denominator === 0 ? 0 : (buyVolume - sellVolume) / denominator,
  };
}

function analyzeOrderbook(rawDepth, referencePrice) {
  const bids = (rawDepth?.bids || []).slice(0, 12).map((entry) => ({
    price: Number(entry[0] || entry.price),
    quantity: Number(entry[1] || entry.qty),
  }));
  const asks = (rawDepth?.asks || []).slice(0, 12).map((entry) => ({
    price: Number(entry[0] || entry.price),
    quantity: Number(entry[1] || entry.qty),
  }));
  const bidSum = bids.reduce((sum, entry) => sum + entry.price * entry.quantity, 0);
  const askSum = asks.reduce((sum, entry) => sum + entry.price * entry.quantity, 0);
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
    const fallback = getFallbackExchangeInfo();
    if (!fallback) throw error;
    exchangeInfoCache = fallback;
  }
  return exchangeInfoCache;
}

async function getPerpUniverse() {
  if (perpUniverseCache) return perpUniverseCache;
  const exchangeInfo = await getExchangeInfo();
  perpUniverseCache = perpUniverseSymbols(exchangeInfo).sort((left, right) => left.symbol.localeCompare(right.symbol));
  return perpUniverseCache;
}

function mapUniverseTickers(entries, activeSymbols) {
  return (entries || [])
    .filter((entry) => activeSymbols.has(entry.symbol))
    .map((entry) => ({
      symbol: entry.symbol,
      lastPrice: Number(entry.lastPrice ?? entry.price ?? entry.markPrice),
      changePct: Number(entry.priceChangePercent) || 0,
      quoteVolume: Number(entry.quoteVolume) || 0,
      volume: Number(entry.volume) || 0,
    }));
}

async function fetchUniverseTickers() {
  const universe = await getPerpUniverse();
  const activeSymbols = new Set(universe.map((item) => item.symbol));
  try {
    const tickers = await fetchJson("https://fapi.binance.com/fapi/v1/ticker/24hr", "24H tickers");
    return mapUniverseTickers(tickers, activeSymbols);
  } catch (error) {
    try {
      const spotTickers = await fetchJson("https://api.binance.com/api/v3/ticker/24hr", "Spot 24H tickers");
      const mappedSpotTickers = mapUniverseTickers(spotTickers, activeSymbols);
      if (mappedSpotTickers.length) return mappedSpotTickers;
    } catch (spotError) {
      // Fall through to the lighter futures price feed.
    }

    try {
      const prices = await fetchJson("https://fapi.binance.com/fapi/v1/ticker/price", "Ticker prices");
      return mapUniverseTickers(prices, activeSymbols);
    } catch (priceError) {
      return Array.from(activeSymbols).map((symbol) => ({
        symbol,
        lastPrice: 0,
        changePct: 0,
        quoteVolume: 0,
        volume: 0,
      }));
    }
  }
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

function aggregateCandles(candles, bucketSize) {
  if (!Array.isArray(candles) || !candles.length || bucketSize <= 1) return candles || [];
  const aggregated = [];
  for (let index = 0; index < candles.length; index += bucketSize) {
    const bucket = candles.slice(index, index + bucketSize).filter(Boolean);
    if (!bucket.length) continue;
    const open = bucket[0];
    const close = bucket[bucket.length - 1];
    aggregated.push({
      time: open.time,
      open: open.open,
      high: Math.max(...bucket.map((entry) => Number(entry.high) || Number.NEGATIVE_INFINITY)),
      low: Math.min(...bucket.map((entry) => Number(entry.low) || Number.POSITIVE_INFINITY)),
      close: close.close,
      volume: bucket.reduce((sum, entry) => sum + (Number(entry.volume) || 0), 0),
    });
  }
  return aggregated.filter(
    (candle) =>
      Number.isFinite(candle.open) &&
      Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.close)
  );
}

async function fetchDirectSnapshot(token) {
  const exchangeInfo = await getExchangeInfo();
  const resolved = resolvePerpSymbol(token, exchangeInfo);

  const requests = await Promise.allSettled([
    fetchJson(
      `https://fapi.binance.com/fapi/v1/klines?symbol=${resolved.symbol}&interval=${STRATEGY_INTERVAL}&limit=240`,
      "Klines"
    ),
    fetchJson(
      `https://fapi.binance.com/fapi/v1/klines?symbol=${resolved.symbol}&interval=${HIGHER_TIMEFRAME_INTERVAL}&limit=180`,
      "Higher timeframe klines"
    ),
    fetchJson(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${resolved.symbol}`, "Ticker"),
    fetchJson(`https://fapi.binance.com/fapi/v1/depth?symbol=${resolved.symbol}&limit=100`, "Depth"),
    fetchJson(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=${resolved.symbol}&limit=400`, "Trades"),
    fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${resolved.symbol}`, "Premium"),
    fetchJson(
      `https://fapi.binance.com/futures/data/openInterestHist?symbol=${resolved.symbol}&period=5m&limit=60`,
      "OI history"
    ),
    fetchJson(
      `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${resolved.symbol}&period=1h&limit=24`,
      "Global L/S"
    ),
    fetchJson(
      `https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${resolved.symbol}&period=5m&limit=24`,
      "Taker ratio"
    ),
  ]);

  const [
    klinesResult,
    higherTimeframeKlinesResult,
    tickerResult,
    depthResult,
    tradesResult,
    premiumResult,
    oiHistoryResult,
    globalResult,
    takerResult,
  ] = requests;

  if (klinesResult.status !== "fulfilled" || tickerResult.status !== "fulfilled") {
    throw new Error(`Core perpetual market data is unavailable for ${resolved.symbol}.`);
  }

  const candles = klinesResult.value.map(mapKlineEntry);
  const candles4h =
    higherTimeframeKlinesResult.status === "fulfilled"
      ? higherTimeframeKlinesResult.value.map(mapKlineEntry)
      : aggregateCandles(candles, 4);

  return {
    token: resolved.cleanedToken,
    symbol: resolved.symbol,
    baseAsset: resolved.baseAsset,
    pricePrecision: resolved.pricePrecision,
    candles,
    candles4h,
    ticker: tickerResult.value,
    depth: depthResult.status === "fulfilled" ? depthResult.value : { bids: [], asks: [] },
    trades: tradesResult.status === "fulfilled" ? tradesResult.value : [],
    premiumIndex: premiumResult.status === "fulfilled" ? premiumResult.value : null,
    openInterestHistory: oiHistoryResult.status === "fulfilled" ? oiHistoryResult.value : [],
    globalLongShort: globalResult.status === "fulfilled" ? globalResult.value : [],
    takerLongShort: takerResult.status === "fulfilled" ? takerResult.value : [],
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
  return new Map(tickers.map((entry) => [entry.symbol, entry]));
}

function selectUniverseBatch(universe, state) {
  const ranked = [...universe].sort((left, right) => {
    const leftTicker = universeTickerMap.get(left.symbol);
    const rightTicker = universeTickerMap.get(right.symbol);
    return (rightTicker?.quoteVolume || 0) - (leftTicker?.quoteVolume || 0);
  });

  const mustTrackSymbols = new Set([
    ...state.openTrades.map((trade) => trade.symbol),
    ...state.demoOrders
      .filter((record) => record?.status && !["FILLED", "CANCELED", "EXPIRED", "REJECTED"].includes(String(record.status).toUpperCase()))
      .map((record) => record.symbol),
  ].filter(Boolean));
  const mustTrack = ranked.filter((item) => mustTrackSymbols.has(item.symbol));
  const priority = ranked.slice(0, PRIORITY_SCAN_COUNT);
  const rotationPool = ranked.slice(PRIORITY_SCAN_COUNT);
  const rotationBatch = [];

  if (rotationPool.length) {
    const start = state.scanCursor % rotationPool.length;
    for (let index = 0; index < Math.min(ROTATION_SCAN_COUNT, rotationPool.length); index += 1) {
      rotationBatch.push(rotationPool[(start + index) % rotationPool.length]);
    }
    state.scanCursor = (start + ROTATION_SCAN_COUNT) % rotationPool.length;
  }

  return Array.from(new Map([...mustTrack, ...priority, ...rotationBatch].map((item) => [item.symbol, item])).values());
}

function wickTouchesLevel(candle, level, side, touchBuffer) {
  if (!candle || !Number.isFinite(level)) return false;
  if (side === "Long") return candle.low <= level + touchBuffer;
  return candle.high >= level - touchBuffer;
}

function levelLabel(side, useLevelTwo) {
  if (side === "Long") return useLevelTwo ? "S2" : "S1";
  return useLevelTwo ? "R2" : "R1";
}

function buildConfluenceLabel(side, useLevelTwo, touch20, touch50) {
  const level = levelLabel(side, useLevelTwo);
  if (touch20 && touch50) return `EMA20/50 + ${level}`;
  if (touch20) return `EMA20 + ${level}`;
  if (touch50) return `EMA50 + ${level}`;
  return level;
}

function rangePosition(candle, side) {
  const candleRange = Math.max(candle.high - candle.low, 0.0000001);
  if (side === "Long") return (candle.close - candle.low) / candleRange;
  return (candle.high - candle.close) / candleRange;
}

function emaSlopeAligned(series, index, side, atrValue, lookback = EMA_SLOPE_LOOKBACK) {
  let supportive = 0;
  let comparisons = 0;
  let netChange = 0;
  const minimumDelta = Math.max((Number(atrValue) || 0) * 0.015, 0);
  for (let cursor = Math.max(1, index - lookback + 1); cursor <= index; cursor += 1) {
    const current = series[cursor];
    const previous = series[cursor - 1];
    if (!Number.isFinite(current) || !Number.isFinite(previous)) continue;
    const delta = current - previous;
    netChange += delta;
    comparisons += 1;
    if (side === "Long" ? delta >= -minimumDelta : delta <= minimumDelta) supportive += 1;
  }
  if (comparisons < 3) return false;
  if (supportive < comparisons - 1) return false;
  return side === "Long" ? netChange > minimumDelta * 2 : netChange < -minimumDelta * 2;
}

function wickRejectedLevel(candle, level, side, touchBuffer, reclaimBuffer) {
  if (!candle || !Number.isFinite(level)) return false;
  const body = Math.abs(candle.close - candle.open);
  const lowerWick = Math.max(Math.min(candle.open, candle.close) - candle.low, 0);
  const upperWick = Math.max(candle.high - Math.max(candle.open, candle.close), 0);
  if (side === "Long") {
    return wickTouchesLevel(candle, level, side, touchBuffer) && candle.close > level + reclaimBuffer && lowerWick > body * 0.45;
  }
  return wickTouchesLevel(candle, level, side, touchBuffer) && candle.close < level - reclaimBuffer && upperWick > body * 0.45;
}

function countFlowConfirmations(side, tradeSummary, takerSummary, depthSummary) {
  let confirmations = 0;
  if (side === "Long") {
    if (tradeSummary.cvdSlope > 0) confirmations += 1;
    if (takerSummary.latestRatio > 1.01) confirmations += 1;
    if (depthSummary.imbalance > 0.01) confirmations += 1;
  } else {
    if (tradeSummary.cvdSlope < 0) confirmations += 1;
    if (takerSummary.latestRatio < 0.99) confirmations += 1;
    if (depthSummary.imbalance < -0.01) confirmations += 1;
  }
  return confirmations;
}

function countLevelRetests(candles, level, side, tolerance, endIndex, window = 36) {
  if (!Number.isFinite(level)) return 0;
  let touches = 0;
  let inTouch = false;
  const start = Math.max(0, endIndex - window);
  for (let index = start; index <= endIndex; index += 1) {
    const touched = wickTouchesLevel(candles[index], level, side, tolerance);
    if (touched && !inTouch) touches += 1;
    inTouch = touched;
  }
  return touches;
}

function postTouchExtension(candles, startIndex, endIndex, level, side) {
  if (!Number.isFinite(level) || endIndex <= startIndex) return 0;
  const segment = candles.slice(startIndex + 1, endIndex + 1);
  if (!segment.length) return 0;
  if (side === "Long") {
    return Math.max(...segment.map((entry) => Math.max((Number(entry.high) || level) - level, 0)));
  }
  return Math.max(...segment.map((entry) => Math.max(level - (Number(entry.low) || level), 0)));
}

function buildSetupBias(currentPrice, latestEma20, latestEma50, latestRsi) {
  let score = 0;
  score += currentPrice > latestEma20 ? 10 : -10;
  score += latestEma20 > latestEma50 ? 14 : -14;
  score += latestRsi >= 50 && latestRsi <= 68 ? 8 : latestRsi < 45 ? -8 : 0;
  if (score >= 16) return { label: "Bullish", tone: "up", summary: "Trend stack still favors bullish pullbacks." };
  if (score <= -16) return { label: "Bearish", tone: "down", summary: "Trend stack still favors bearish pullbacks." };
  return { label: "Balanced", tone: "neutral", summary: "Trend stack is mixed, so pullback quality is lower." };
}

function buildTradezSignals(snapshot, quoteVolume = 0) {
  const candles = (snapshot.candles || []).map((candle) => ({ ...candle }));
  const higherTimeframeCandles =
    Array.isArray(snapshot.candles4h) && snapshot.candles4h.length
      ? snapshot.candles4h.map((candle) => ({ ...candle }))
      : aggregateCandles(candles, 4);
  const closes = candles.map((candle) => candle.close);
  const higherTimeframeCloses = higherTimeframeCandles.map((candle) => candle.close);
  const currentPrice = Number(snapshot.premiumIndex?.markPrice) || Number(snapshot.ticker?.lastPrice) || closes[closes.length - 1] || 0;
  const ema20Series = ema(closes, 20);
  const ema50Series = ema(closes, 50);
  const rsiSeries = rsi(closes, 14);
  const atrSeries = atr(candles, 14);
  const higherTimeframeEma20Series = ema(higherTimeframeCloses, 20);
  const higherTimeframeEma50Series = ema(higherTimeframeCloses, 50);
  const higherTimeframeRsiSeries = rsi(higherTimeframeCloses, 14);
  const latestEma20 = latestDefinedValue(ema20Series) ?? currentPrice;
  const latestEma50 = latestDefinedValue(ema50Series) ?? currentPrice;
  const latestRsi = latestDefinedValue(rsiSeries) ?? 50;
  const latestAtr = latestDefinedValue(atrSeries) ?? currentPrice * 0.01;
  const higherTimeframeEma20 = latestDefinedValue(higherTimeframeEma20Series) ?? latestEma20;
  const higherTimeframeEma50 = latestDefinedValue(higherTimeframeEma50Series) ?? latestEma50;
  const higherTimeframeRsi = latestDefinedValue(higherTimeframeRsiSeries) ?? latestRsi;
  const supportResistance = computeSupportResistance(candles, currentPrice, latestAtr);
  const tradeSummary = analyzeTradeTape(snapshot.trades || []);
  const depthSummary = analyzeOrderbook(snapshot.depth || { bids: [], asks: [] }, currentPrice);
  const takerSummary = analyzeTakerLongShort(snapshot.takerLongShort || []);
  const oiHistory = (snapshot.openInterestHistory || []).map((entry) => Number(entry.sumOpenInterest));
  const oiChange1h = pctChangeFromLookback(oiHistory, 12);
  const fundingRate = (Number(snapshot.premiumIndex?.lastFundingRate) || 0) * 100;
  const longFlowConfirmations = countFlowConfirmations("Long", tradeSummary, takerSummary, depthSummary);
  const shortFlowConfirmations = countFlowConfirmations("Short", tradeSummary, takerSummary, depthSummary);
  const buyerLed = longFlowConfirmations === 3;
  const sellerLed = shortFlowConfirmations === 3;
  const higherTimeframeLongConfirmed = higherTimeframeEma20 > higherTimeframeEma50 && higherTimeframeRsi > 50;
  const higherTimeframeShortConfirmed = higherTimeframeEma20 < higherTimeframeEma50 && higherTimeframeRsi < 50;
  const bias = buildSetupBias(currentPrice, latestEma20, latestEma50, latestRsi);
  const completedLimit = Math.max(55, candles.length - 24);
  const markers = [];
  const historicalSignals = [];
  let activeSignal = null;
  const [support1, support2] = supportResistance.supportLevels;
  const [resistance1, resistance2] = supportResistance.resistanceLevels;

  for (let index = completedLimit; index < candles.length - 1; index += 1) {
    const candle = candles[index];
    const nextCandle = candles[index + 1];
    const ema20Value = ema20Series[index];
    const ema50Value = ema50Series[index];
    const atrValue = atrSeries[index] ?? latestAtr;
    const rsiValue = rsiSeries[index] ?? latestRsi;
    if (!Number.isFinite(ema20Value) || !Number.isFinite(ema50Value) || !Number.isFinite(atrValue)) continue;

    const bullishTrend = ema20Value > ema50Value;
    const bearishTrend = ema20Value < ema50Value;
    const tolerance = Math.max(atrValue * 0.16, candle.close * 0.0012, supportResistance.bandWidth * 0.45);
    const strictLevelTouchBuffer = Math.max(
      atrValue * STRICT_LEVEL_TOUCH_BUFFER_ATR,
      candle.close * 0.00035,
      supportResistance.bandWidth * 0.12
    );
    const strictLevelReclaimBuffer = Math.max(
      atrValue * STRICT_LEVEL_RECLAIM_BUFFER_ATR,
      candle.close * 0.0002,
      strictLevelTouchBuffer * 0.55
    );
    const emaSeparationAtr = Math.abs(ema20Value - ema50Value) / Math.max(atrValue, 0.0000001);
    const touch20 = candle.low <= ema20Value + tolerance && candle.high >= ema20Value - tolerance;
    const touch50 = candle.low <= ema50Value + tolerance && candle.high >= ema50Value - tolerance;
    const previousCandle = candles[index - 1];
    const currentLongTouchS1 = wickRejectedLevel(candle, support1, "Long", strictLevelTouchBuffer, strictLevelReclaimBuffer);
    const currentLongTouchS2 = wickRejectedLevel(candle, support2, "Long", strictLevelTouchBuffer, strictLevelReclaimBuffer);
    const previousLongTouchS1 = wickRejectedLevel(previousCandle, support1, "Long", strictLevelTouchBuffer, strictLevelReclaimBuffer);
    const previousLongTouchS2 = wickRejectedLevel(previousCandle, support2, "Long", strictLevelTouchBuffer, strictLevelReclaimBuffer);
    const currentShortTouchR1 = wickRejectedLevel(candle, resistance1, "Short", strictLevelTouchBuffer, strictLevelReclaimBuffer);
    const currentShortTouchR2 = wickRejectedLevel(candle, resistance2, "Short", strictLevelTouchBuffer, strictLevelReclaimBuffer);
    const previousShortTouchR1 = wickRejectedLevel(previousCandle, resistance1, "Short", strictLevelTouchBuffer, strictLevelReclaimBuffer);
    const previousShortTouchR2 = wickRejectedLevel(previousCandle, resistance2, "Short", strictLevelTouchBuffer, strictLevelReclaimBuffer);
    const averageVolume20 = average(candles.slice(Math.max(0, index - 20), index).map((entry) => entry.volume).filter(Boolean));
    const previousAverageVolume20 =
      previousCandle
        ? average(candles.slice(Math.max(0, index - 21), index - 1).map((entry) => entry.volume).filter(Boolean))
        : 0;
    const volumeFactor = averageVolume20 ? candle.volume / averageVolume20 : 1;
    const previousVolumeFactor = previousAverageVolume20 ? previousCandle.volume / previousAverageVolume20 : 1;
    const bullishVolumeConfirmed =
      candle.close > candle.open &&
      volumeFactor >= MIN_VISIBLE_SIGNAL_VOLUME_FACTOR &&
      rangePosition(candle, "Long") >= 0.52 &&
      (!nextCandle || nextCandle.close >= candle.close * 0.992);
    const previousBullishVolumeConfirmed =
      previousCandle &&
      previousCandle.close > previousCandle.open &&
      previousVolumeFactor >= MIN_VISIBLE_SIGNAL_VOLUME_FACTOR &&
      rangePosition(previousCandle, "Long") >= 0.52 &&
      candle.close >= previousCandle.close * 0.992;
    const bearishVolumeConfirmed =
      candle.close < candle.open &&
      volumeFactor >= MIN_VISIBLE_SIGNAL_VOLUME_FACTOR &&
      rangePosition(candle, "Short") >= 0.52 &&
      (!nextCandle || nextCandle.close <= candle.close * 1.008);
    const previousBearishVolumeConfirmed =
      previousCandle &&
      previousCandle.close < previousCandle.open &&
      previousVolumeFactor >= MIN_VISIBLE_SIGNAL_VOLUME_FACTOR &&
      rangePosition(previousCandle, "Short") >= 0.52 &&
      candle.close <= previousCandle.close * 1.008;
    const longSlopeAligned = emaSlopeAligned(ema20Series, index, "Long", atrValue);
    const shortSlopeAligned = emaSlopeAligned(ema20Series, index, "Short", atrValue);
    const longSetup =
      bullishTrend &&
      higherTimeframeLongConfirmed &&
      longSlopeAligned &&
      emaSeparationAtr >= MIN_EMA_SEPARATION_ATR &&
      longFlowConfirmations >= 1 &&
      (((currentLongTouchS1 || currentLongTouchS2) && bullishVolumeConfirmed) ||
        ((previousLongTouchS1 || previousLongTouchS2) && previousBullishVolumeConfirmed));
    const shortSetup =
      bearishTrend &&
      higherTimeframeShortConfirmed &&
      shortSlopeAligned &&
      emaSeparationAtr >= MIN_EMA_SEPARATION_ATR &&
      shortFlowConfirmations >= 1 &&
      (((currentShortTouchR1 || currentShortTouchR2) && bearishVolumeConfirmed) ||
        ((previousShortTouchR1 || previousShortTouchR2) && previousBearishVolumeConfirmed));

    if (!longSetup && !shortSetup) continue;

    const side = longSetup ? "Long" : "Short";
    const tone = side === "Long" ? "up" : "down";
    const useLevelTwo = side === "Long"
      ? currentLongTouchS2 || previousLongTouchS2
      : currentShortTouchR2 || previousShortTouchR2;
    const touchedCandle =
      side === "Long"
        ? currentLongTouchS2 || currentLongTouchS1
          ? candle
          : previousCandle
        : currentShortTouchR2 || currentShortTouchR1
          ? candle
          : previousCandle;
    const touchIndex =
      side === "Long"
        ? currentLongTouchS2 || currentLongTouchS1
          ? index
          : index - 1
        : currentShortTouchR2 || currentShortTouchR1
          ? index
          : index - 1;
    const testedLevel = side === "Long" ? (useLevelTwo ? support2 : support1) : useLevelTwo ? resistance2 : resistance1;
    const anchorLevel = Number.isFinite(testedLevel)
      ? testedLevel
      : side === "Long"
        ? Math.min(touchedCandle.low, ema20Value, ema50Value)
        : Math.max(touchedCandle.high, ema20Value, ema50Value);
    const levelTag = levelLabel(side, useLevelTwo);
    const confluenceLabel = buildConfluenceLabel(side, useLevelTwo, touch20, touch50);
    const flowConfirmations = side === "Long" ? longFlowConfirmations : shortFlowConfirmations;
    const higherTimeframeConfirmed = side === "Long" ? higherTimeframeLongConfirmed : higherTimeframeShortConfirmed;
    const rejectionVolumeFactor = touchIndex === index ? volumeFactor : previousVolumeFactor;
    const softerDisplayFlowConfirmed =
      flowConfirmations >= 2 ||
      (
        flowConfirmations >= 1 &&
        higherTimeframeConfirmed &&
        (hasGoodTradingVolume(quoteVolume) || rejectionVolumeFactor >= MIN_VISIBLE_SIGNAL_VOLUME_FACTOR) &&
        (
          side === "Long"
            ? tradeSummary.cvdSlope > 0 || takerSummary.latestRatio > 1 || depthSummary.imbalance > 0
            : tradeSummary.cvdSlope < 0 || takerSummary.latestRatio < 1 || depthSummary.imbalance < 0
        )
      );
    const rejectionRangePosition = rangePosition(touchedCandle, side);
    const wickRejected = wickRejectedLevel(touchedCandle, anchorLevel, side, strictLevelTouchBuffer, strictLevelReclaimBuffer);
    const retestCount = countLevelRetests(candles, anchorLevel, side, strictLevelTouchBuffer, touchIndex, 40);
    const emaAnchorLow = Math.min(
      anchorLevel,
      touch20 ? ema20Value : anchorLevel,
      touch50 ? ema50Value : anchorLevel,
      touchedCandle.low
    );
    const emaAnchorHigh = Math.max(
      anchorLevel,
      touch20 ? ema20Value : anchorLevel,
      touch50 ? ema50Value : anchorLevel,
      touchedCandle.high
    );
    const entryLow = side === "Long" ? emaAnchorLow - tolerance * 0.16 : Math.min(anchorLevel, candle.close) - tolerance * 0.08;
    const entryHigh = side === "Long" ? Math.max(anchorLevel, candle.close, touch20 ? ema20Value : anchorLevel, touch50 ? ema50Value : anchorLevel) + tolerance * 0.08 : emaAnchorHigh + tolerance * 0.16;
    const entryReference = average([entryLow, entryHigh]);
    const nearestSupport = support1 ?? entryReference - atrValue * 1.1;
    const secondSupport = support2 ?? nearestSupport - atrValue * 0.9;
    const nearestResistance = resistance1 ?? entryReference + atrValue * 1.1;
    const secondResistance = resistance2 ?? nearestResistance + atrValue * 0.9;
    const stopLoss =
      side === "Long"
        ? Math.min(anchorLevel, touchedCandle.low) - Math.max(supportResistance.bandWidth * 0.45, atrValue * 0.18)
        : Math.max(anchorLevel, touchedCandle.high) + Math.max(supportResistance.bandWidth * 0.45, atrValue * 0.18);
    const risk = Math.max(Math.abs(entryReference - stopLoss), atrValue * 0.55);
    const tp1 =
      side === "Long"
        ? Math.max(nearestResistance, entryReference + risk * 1.2)
        : Math.min(nearestSupport, entryReference - risk * 1.2);
    const tp2 =
      side === "Long"
        ? Math.max(secondResistance, tp1 + atrValue * 0.55)
        : Math.min(secondSupport, tp1 - atrValue * 0.55);
    const room = side === "Long" ? tp1 - entryReference : entryReference - tp1;
    const rr = Math.abs(tp1 - entryReference) / Math.max(risk, 0.0000001);
    const recentDistancePct = Math.abs(pctChange(entryReference, currentPrice));
    const sinceTouchBars = candles.length - 2 - touchIndex;
    const extensionFromTouch = postTouchExtension(candles, touchIndex, candles.length - 2, anchorLevel, side);
    const executionDistanceFromTouch = Math.abs(entryReference - anchorLevel);
    const staleSetup = sinceTouchBars > MAX_STALE_SIGNAL_BARS;
    const overextendedSetup = extensionFromTouch > atrValue * MAX_POST_TOUCH_EXTENSION_ATR;
    const chasedSetup = executionDistanceFromTouch > atrValue * MAX_EXECUTION_DISTANCE_FROM_TOUCH_ATR;
    if (!wickRejected || retestCount > 2 || staleSetup || overextendedSetup || chasedSetup || !softerDisplayFlowConfirmed) continue;
    const emaConfluenceScore = touch20 && touch50 ? 18 : touch50 ? 14 : touch20 ? 12 : 4;
    let qualityScore = 46;
    qualityScore += 18;
    qualityScore += useLevelTwo ? 20 : 12;
    qualityScore += emaConfluenceScore;
    qualityScore += emaSeparationAtr >= 0.5 ? 12 : emaSeparationAtr >= 0.32 ? 7 : -10;
    qualityScore += flowConfirmations === 3 ? 12 : 4;
    qualityScore += (side === "Long" ? touchedCandle.close > touchedCandle.open : touchedCandle.close < touchedCandle.open) ? 10 : 0;
    qualityScore += rejectionRangePosition >= 0.62 ? 8 : -6;
    qualityScore += rejectionVolumeFactor >= 1.4 ? 16 : rejectionVolumeFactor >= 1.15 ? 10 : -12;
    qualityScore += hasGoodTradingVolume(quoteVolume) ? 10 : -10;
    qualityScore += side === "Long" ? (tradeSummary.cvdSlope > 0 ? 10 : -8) : tradeSummary.cvdSlope < 0 ? 10 : -8;
    qualityScore += side === "Long" ? (depthSummary.imbalance > 0 ? 6 : -6) : depthSummary.imbalance < 0 ? 6 : -6;
    qualityScore += side === "Long" ? (takerSummary.latestRatio > 1.01 ? 8 : -6) : takerSummary.latestRatio < 0.99 ? 8 : -6;
    qualityScore += side === "Long" ? (oiChange1h > 0 ? 8 : -6) : oiChange1h > 0 ? 6 : 0;
    qualityScore += side === "Long"
      ? rsiValue >= 50 && rsiValue <= 68
        ? 8
        : rsiValue > 74
          ? -10
          : 0
      : rsiValue <= 50 && rsiValue >= 32
        ? 8
        : rsiValue < 26
          ? -10
          : 0;
    qualityScore += rr >= 1.8 ? 16 : rr >= 1.2 ? 8 : -10;
    qualityScore += room / Math.max(risk, 0.0000001) >= 1.2 ? 8 : -10;
    qualityScore -= sinceTouchBars * 4;
    qualityScore += wickRejected ? 10 : -14;
    qualityScore += retestCount === 1 ? 8 : retestCount === 2 ? 2 : -18;
    qualityScore += side === "Long"
      ? higherTimeframeLongConfirmed
        ? 10
        : -18
      : higherTimeframeShortConfirmed
        ? 10
        : -18;
    if (recentDistancePct > 1.8) qualityScore -= 14;
    if (Math.abs(fundingRate) > 0.04 && ((side === "Long" && fundingRate > 0) || (side === "Short" && fundingRate < 0))) {
      qualityScore -= 6;
    }
    const flowAligned = side === "Long" ? buyerLed : sellerLed;
    if (!hasGoodTradingVolume(quoteVolume)) qualityScore -= 18;
    if (rejectionVolumeFactor < MIN_VISIBLE_SIGNAL_VOLUME_FACTOR) qualityScore -= 12;
    if (!flowAligned) qualityScore -= 18;
    if (!touch20 && !touch50 && !useLevelTwo) qualityScore -= 10;
    if (side === "Long" && !touch20 && !touch50) qualityScore -= 8;
    if (side === "Short" && !touch20 && !touch50) qualityScore -= 4;
    if (useLevelTwo && flowAligned) qualityScore += side === "Short" ? 14 : 10;
    if (side === "Long" && tradeSummary.cvdSlope <= 0) qualityScore -= 12;
    if (side === "Short" && tradeSummary.cvdSlope >= 0) qualityScore -= 12;

    let qualityCap = 180;
    if (!hasGoodTradingVolume(quoteVolume)) qualityCap = Math.min(qualityCap, 110);
    if (rejectionVolumeFactor < MIN_VISIBLE_SIGNAL_VOLUME_FACTOR) qualityCap = Math.min(qualityCap, 120);
    if (!flowAligned) qualityCap = Math.min(qualityCap, 120);
    if (!touch20 && !touch50 && !useLevelTwo) qualityCap = Math.min(qualityCap, 115);
    const elite =
      flowAligned &&
      hasGoodTradingVolume(quoteVolume) &&
      rejectionVolumeFactor >= 1.2 &&
      rr >= 1.6 &&
      (useLevelTwo || touch20 || touch50);
    if (!elite) qualityCap = Math.min(qualityCap, 138);
    qualityScore = Math.min(qualityScore, qualityCap);
    if (rr < MIN_VISIBLE_SIGNAL_RR || tp2 === tp1) continue;

    const signal = {
      id: `${snapshot.symbol}:${side}:${confluenceLabel}:${touchedCandle.time}`,
      time: touchedCandle.time,
      detectedAt: touchedCandle.time * 1000,
      symbol: snapshot.symbol,
      token: snapshot.token,
      side,
      tone,
      touch: confluenceLabel,
      strength: useLevelTwo ? "Strong Signal" : "Good Signal",
      levelTag,
      testedLevel: anchorLevel,
      qualityScore: Math.max(0, Math.round(qualityScore)),
      entryLow,
      entryHigh,
      stopLoss,
      tp1,
      tp2,
      rr,
      sinceTouchBars,
      recentDistancePct,
      retestCount,
      flowConfirmations,
      wickRejected,
      emaSeparationAtr,
      higherTimeframeConfirmed,
      extensionFromTouch,
      executionDistanceFromTouch,
      volumeFactor: rejectionVolumeFactor,
      moveStopToEntryAfterTp1: true,
      note:
        side === "Long"
          ? `${confluenceLabel} held while EMA20 stays above EMA50. TP1 is R1, TP2 is R2, and the stop moves to entry after TP1.`
          : `${confluenceLabel} held while EMA50 stays above EMA20. TP1 is S1, TP2 is S2, and the stop moves to entry after TP1.`,
      reasonParts: [
        useLevelTwo ? `${levelTag} strong` : `${levelTag} good`,
        touch20 || touch50 ? `EMA confluence ${touch20 && touch50 ? "20/50" : touch50 ? "50" : "20"}` : "level-led setup",
        "EMA20 slope aligned",
        `EMA separation ${emaSeparationAtr.toFixed(2)} ATR`,
        "wick rejection confirmed",
        `flow ${flowConfirmations}/3`,
        retestCount <= 1 ? "first retest" : "second retest",
        side === "Long"
          ? higherTimeframeLongConfirmed
            ? "4H trend confirmed"
            : "4H trend mixed"
          : higherTimeframeShortConfirmed
            ? "4H trend confirmed"
            : "4H trend mixed",
        hasGoodTradingVolume(quoteVolume) ? "good liquidity" : "thin liquidity",
        rejectionVolumeFactor >= 1.15 ? "buy/sell volume confirmed" : "volume soft",
        side === "Long" ? (tradeSummary.cvdSlope > 0 ? "CVD supportive" : "CVD soft") : tradeSummary.cvdSlope < 0 ? "CVD supportive" : "CVD soft",
        side === "Long" ? (takerSummary.latestRatio > 1 ? "buyers active" : "buyers not leading") : takerSummary.latestRatio < 1 ? "sellers active" : "sellers not leading",
      ],
    };

    historicalSignals.push(signal);
    markers.push({
      time: touchedCandle.time,
      position: side === "Long" ? "belowBar" : "aboveBar",
      color: side === "Long" ? "#35c282" : "#e04c4c",
      shape: "circle",
      text: `${side === "Long" ? "L" : "S"}${useLevelTwo ? "2" : "1"}`,
    });

    if (!activeSignal && signal.sinceTouchBars <= MAX_STALE_SIGNAL_BARS) {
      activeSignal = signal;
    } else if (
      signal.sinceTouchBars <= MAX_STALE_SIGNAL_BARS &&
      signal.qualityScore > (activeSignal?.qualityScore || 0)
    ) {
      activeSignal = signal;
    }
  }

  const setupBias = activeSignal
    ? {
        label: activeSignal.side === "Long" ? "Bullish Pullback" : "Bearish Pullback",
        tone: activeSignal.tone,
        summary: activeSignal.note,
      }
    : bias;

  return {
    symbol: snapshot.symbol,
    token: snapshot.token,
    pricePrecision: snapshot.pricePrecision || 2,
    currentPrice,
    change24h: Number(snapshot.ticker?.priceChangePercent) || 0,
    latestEma20,
    latestEma50,
    latestRsi,
    latestAtr,
    latestVolume: candles[candles.length - 1]?.volume || 0,
    supportResistance,
    setupBias,
    tradeSummary,
    depthSummary,
    takerSummary,
    oiChange1h,
    fundingRate,
    markers: markers.slice(-12),
    historicalSignals: historicalSignals.slice(-10),
    activeSignal,
    qualityScore: activeSignal?.qualityScore ?? 0,
  };
}

function tradezPaperReservedMargin(state) {
  return state.openTrades.reduce((sum, trade) => sum + (Number(trade.marginUsed) || 0), 0);
}

function tradezPaperHasOpenTrade(state, symbol) {
  return state.openTrades.some((trade) => trade.symbol === symbol);
}

function tradezPaperRecentlyClosed(state, symbol) {
  return state.closedTrades.some(
    (trade) => trade.symbol === symbol && Date.now() - Number(trade.closedAt || 0) < TRADEZ_AUTO_TRADE_COOLDOWN_MS
  );
}

function tradezPaperReturnPct(trade, exitPrice) {
  const direction = trade.side === "Short" ? -1 : 1;
  return pctChange(trade.entryPrice, exitPrice) * direction * (trade.leverage || TRADEZ_AUTO_LEVERAGE);
}

function tradezEntryReason(candidate) {
  const signal = candidate.activeSignal;
  return `${signal.side} EMA pullback into ${signal.touch} (${signal.strength}) with 1H confluence, strong volume confirmation, and structured TP1/TP2 management.`;
}

function tradezKeyDetails(candidate) {
  return (candidate.activeSignal?.reasonParts || []).join(" • ");
}

function buildTradezAutoCandidate(candidate) {
  const signal = candidate.activeSignal;
  if (!signal) return null;
  const plannedEntry = average([signal.entryLow, signal.entryHigh]);
  const structuralStop = signal.stopLoss;
  const maxMarginStopPct = 10 / TRADEZ_AUTO_LEVERAGE;
  const cappedStop =
    signal.side === "Long"
      ? plannedEntry * (1 - maxMarginStopPct / 100)
      : plannedEntry * (1 + maxMarginStopPct / 100);
  const stopLoss =
    signal.side === "Long" ? Math.max(structuralStop, cappedStop) : Math.min(structuralStop, cappedStop);
  const stopMarginPct = Math.abs(pctChange(plannedEntry, stopLoss)) * TRADEZ_AUTO_LEVERAGE;
  const tp1 = signal.tp1;
  const tp2 = signal.tp2;
  const tp2MarginPct = Math.abs(pctChange(plannedEntry, tp2)) * TRADEZ_AUTO_LEVERAGE;
  const rr = Math.abs(tp1 - plannedEntry) / Math.max(Math.abs(plannedEntry - stopLoss), 0.0000001);

  return {
    ...candidate,
    paperTrade: {
      plannedEntry,
      entryZoneLow: Math.min(signal.entryLow, signal.entryHigh),
      entryZoneHigh: Math.max(signal.entryLow, signal.entryHigh),
      stopLoss,
      tp1,
      tp2,
      leverage: TRADEZ_AUTO_LEVERAGE,
      targetMarginPct: tp2MarginPct,
      stopMarginPct,
      rr,
    },
  };
}

function candidateIsExecutable(candidate) {
  const plan = candidate.paperTrade;
  const signal = candidate.activeSignal;
  if (!plan || !signal || !Number.isFinite(candidate.currentPrice)) return false;
  if (!Number.isFinite(candidate.latestAtr) || candidate.latestAtr <= 0) return false;
  if (!Number.isFinite(signal.testedLevel)) return false;
  const atrBuffer = Math.max(candidate.latestAtr * LIVE_ENTRY_BUFFER_ATR, 0);
  const directionalLevelLimit = candidate.latestAtr * 1.2;
  const insideZone =
    candidate.currentPrice >= plan.entryZoneLow && candidate.currentPrice <= plan.entryZoneHigh;
  const nearTouchedLevel =
    signal.side === "Long"
      ? candidate.currentPrice >= signal.testedLevel - atrBuffer &&
        candidate.currentPrice <= signal.testedLevel + directionalLevelLimit
      : candidate.currentPrice <= signal.testedLevel + atrBuffer &&
        candidate.currentPrice >= signal.testedLevel - directionalLevelLimit;

  if (signal.side === "Long") {
    if (candidate.currentPrice > signal.testedLevel + directionalLevelLimit) return false;
    return insideZone || nearTouchedLevel;
  }

  if (candidate.currentPrice < signal.testedLevel - directionalLevelLimit) return false;
  return insideZone || nearTouchedLevel;
}

function highQualityTradezAutoCandidates(candidates, threshold) {
  const executionThreshold = Math.max(
    TRADEZ_AUTO_MIN_EXECUTION_THRESHOLD,
    Number(threshold || 0) + TRADEZ_AUTO_EXECUTION_THRESHOLD_BUFFER
  );
  return candidates
    .map(buildTradezAutoCandidate)
    .filter(Boolean)
    .filter((candidate) => candidate.qualityScore >= executionThreshold)
    .filter((candidate) => candidate.paperTrade.rr >= MIN_EXECUTION_RR)
    .filter((candidate) => (candidate.activeSignal?.sinceTouchBars || 0) <= MAX_AUTO_ENTRY_SIGNAL_BARS)
    .filter(
      (candidate) =>
        (candidate.activeSignal?.flowConfirmations || 0) >= 2 ||
        ((candidate.activeSignal?.flowConfirmations || 0) >= 1 &&
          candidate.paperTrade.rr >= MIN_EXECUTION_RR &&
          (candidate.activeSignal?.higherTimeframeConfirmed ||
            candidate.qualityScore >= executionThreshold + 2))
    )
    .filter((candidate) => (candidate.activeSignal?.retestCount || 0) <= 4)
    .filter((candidate) => (candidate.activeSignal?.volumeFactor || 0) >= MIN_AUTO_EXECUTION_VOLUME_FACTOR)
    .filter(
      (candidate) =>
        !Number.isFinite(candidate.activeSignal?.extensionFromTouch) ||
        candidate.activeSignal.extensionFromTouch <= candidate.latestAtr * MAX_POST_TOUCH_EXTENSION_ATR
    )
    .filter(candidateIsExecutable)
    .sort((left, right) => {
      const rightSeen = right.identifiedAt || right.activeSignal?.detectedAt || 0;
      const leftSeen = left.identifiedAt || left.activeSignal?.detectedAt || 0;
      return right.qualityScore - left.qualityScore || rightSeen - leftSeen;
    });
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

async function openTradezPaperTrade(state, candidate) {
  if (tradezPaperHasOpenTrade(state, candidate.symbol)) return false;
  if (state.openTrades.length >= TRADEZ_AUTO_MAX_CONCURRENT_TRADES) return false;
  if (!candidateIsExecutable(candidate)) return false;

  const freeCapital = Math.max(state.balance - tradezPaperReservedMargin(state), 0);
  if (freeCapital < 10) return false;

  const actualEntry = candidate.currentPrice;
  const slotsRemaining = Math.max(1, TRADEZ_AUTO_MAX_CONCURRENT_TRADES - state.openTrades.length);
  const marginBudget = Math.min(
    freeCapital,
    Math.max(state.startingBalance * 0.03, freeCapital / slotsRemaining)
  );
  const riskCapital = Math.max(marginBudget * 0.12, 2);
  const stopDistance = Math.abs(actualEntry - candidate.paperTrade.stopLoss);
  const quantityByRisk = stopDistance > 0 ? riskCapital / stopDistance : 0;
  const quantityByCapital = (marginBudget * candidate.paperTrade.leverage) / actualEntry;
  const quantity = Math.max(0, Math.min(quantityByRisk, quantityByCapital));
  if (!Number.isFinite(quantity) || quantity <= 0) return false;

  const trade = sanitizeTrade({
    id: `${Date.now()}-ema-${candidate.symbol}`,
    strategyLabel: "Auto Trade 2",
    symbol: candidate.symbol,
    token: candidate.token,
    side: candidate.activeSignal.side,
    touch: candidate.activeSignal.touch,
    strength: candidate.activeSignal.strength,
    entryPrice: actualEntry,
    entryZoneLow: candidate.paperTrade.entryZoneLow,
    entryZoneHigh: candidate.paperTrade.entryZoneHigh,
    stopLoss: candidate.paperTrade.stopLoss,
    tp1: candidate.paperTrade.tp1,
    tp2: candidate.paperTrade.tp2,
    currentTarget: candidate.paperTrade.tp1,
    tp1Hit: false,
    quantity,
    leverage: candidate.paperTrade.leverage,
    marginUsed: marginBudget,
    qualityScore: candidate.qualityScore,
    rr: candidate.paperTrade.rr,
    entryReason: tradezEntryReason(candidate),
    keyDetails: tradezKeyDetails(candidate),
    signalNote: candidate.activeSignal.note,
    pricePrecision: candidate.pricePrecision,
    detectedAt: candidate.identifiedAt || candidate.activeSignal.detectedAt || Date.now(),
    openedAt: Date.now(),
    lastPrice: candidate.currentPrice,
    breakEvenArmed: false,
    executionMode: "demo",
  });

  state.openTrades.push(trade);
  logActivity(
    state,
    `Opened Auto Trade 2 ${trade.side} ${trade.symbol} • entry ${formatPrice(
      actualEntry,
      candidate.pricePrecision
    )} • TP1 ${formatPrice(candidate.paperTrade.tp1, candidate.pricePrecision)} • TP2 ${formatPrice(
      candidate.paperTrade.tp2,
      candidate.pricePrecision
    )} • SL ${formatPrice(candidate.paperTrade.stopLoss, candidate.pricePrecision)} • Q${candidate.qualityScore}.`,
    candidate.activeSignal.tone
  );

  await safeInsertSignalEvent({
    eventId: `${trade.id}:signal-opened`,
    source: "server",
    strategy: "ema_book",
    strategyVersion: TRADEZ_AUTO_VERSION,
    signalType: "ema_pullback_confluence",
    symbol: trade.symbol,
    token: trade.token,
    side: trade.side,
    interval: STRATEGY_INTERVAL,
    touch: trade.touch,
    strength: trade.strength,
    qualityScore: trade.qualityScore,
    detectedAt: trade.detectedAt,
    openedAt: trade.openedAt,
    eventTime: trade.openedAt,
    entryLow: trade.entryZoneLow,
    entryHigh: trade.entryZoneHigh,
    entryPrice: trade.entryPrice,
    tp1: trade.tp1,
    tp2: trade.tp2,
    stopLoss: trade.stopLoss,
    leverage: trade.leverage,
    pricePrecision: trade.pricePrecision,
    metadata: {
      note: candidate.activeSignal?.note || null,
      reasonParts: candidate.activeSignal?.reasonParts || [],
      rr: candidate.paperTrade?.rr || null,
      targetMarginPct: candidate.paperTrade?.targetMarginPct || null,
      stopMarginPct: candidate.paperTrade?.stopMarginPct || null,
      currentPrice: candidate.currentPrice,
      fundingRate: candidate.fundingRate,
      oiChange1h: candidate.oiChange1h,
      latestRsi: candidate.latestRsi,
      latestAtr: candidate.latestAtr,
      latestVolume: candidate.latestVolume,
      quoteVolume: Number(universeTickerMap.get(candidate.symbol)?.quoteVolume) || 0,
      executionMode: trade.executionMode,
    },
  });

  await safeInsertTradeEvent({
    eventId: `${trade.id}:opened:${trade.openedAt}`,
    tradeId: trade.id,
    source: "server",
    strategy: "ema_book",
    strategyVersion: TRADEZ_AUTO_VERSION,
    eventType: "opened",
    symbol: trade.symbol,
    side: trade.side,
    eventTime: trade.openedAt,
    detectedAt: trade.detectedAt,
    openedAt: trade.openedAt,
    entryPrice: trade.entryPrice,
    tp1: trade.tp1,
    tp2: trade.tp2,
    stopLoss: trade.stopLoss,
    leverage: trade.leverage,
    quantity: trade.quantity,
    marginUsed: trade.marginUsed,
    qualityScore: trade.qualityScore,
    metadata: {
      touch: trade.touch,
      strength: trade.strength,
      entryZoneLow: trade.entryZoneLow,
      entryZoneHigh: trade.entryZoneHigh,
      executionMode: trade.executionMode,
    },
  });

  return trade;
}

async function closeTradezPaperTrade(state, tradeId, reason, exitPrice, precisionHint) {
  const index = state.openTrades.findIndex((trade) => trade.id === tradeId);
  if (index === -1) return null;

  const trade = state.openTrades[index];
  const direction = trade.side === "Short" ? -1 : 1;
  const pnlUsd = (exitPrice - trade.entryPrice) * trade.quantity * direction;
  const returnPct = tradezPaperReturnPct(trade, exitPrice);
  state.balance += pnlUsd;

  const closedTrade = sanitizeTrade({
    ...trade,
    exitPrice,
    closedAt: Date.now(),
    reason,
    pnlUsd,
    returnPct,
    balanceAfter: state.balance,
  });
  state.closedTrades.unshift(closedTrade);
  state.closedTrades = state.closedTrades.slice(0, 100);
  state.openTrades.splice(index, 1);

  logActivity(
    state,
    `${reason} closed Auto Trade 2 ${trade.side} ${trade.symbol} • entry ${formatPrice(
      trade.entryPrice,
      precisionHint
    )} • exit ${formatPrice(exitPrice, precisionHint)} • ${formatPercent(returnPct)} on margin • ${formatCompactUsd(
      pnlUsd,
      2
    )}.`,
    reason === "TP" ? "up" : reason === "BE" ? "neutral" : "down"
  );

  await safeInsertTradeEvent({
    eventId: `${trade.id}:${reason.toLowerCase()}:${closedTrade.closedAt}`,
    tradeId: trade.id,
    source: "server",
    strategy: "ema_book",
    strategyVersion: TRADEZ_AUTO_VERSION,
    eventType: reason === "TP" ? "tp_hit" : reason === "BE" ? "break_even_exit" : "sl_hit",
    symbol: trade.symbol,
    side: trade.side,
    eventTime: closedTrade.closedAt,
    detectedAt: trade.detectedAt,
    openedAt: trade.openedAt,
    closedAt: closedTrade.closedAt,
    entryPrice: trade.entryPrice,
    exitPrice: closedTrade.exitPrice,
    tp1: trade.tp1,
    tp2: trade.tp2,
    stopLoss: trade.stopLoss,
    leverage: trade.leverage,
    quantity: trade.quantity,
    marginUsed: trade.marginUsed,
    qualityScore: trade.qualityScore,
    returnPct: closedTrade.returnPct,
    pnlUsd: closedTrade.pnlUsd,
    balanceAfter: closedTrade.balanceAfter,
    metadata: {
      closeReason: reason,
      touch: trade.touch,
      strength: trade.strength,
      entryZoneLow: trade.entryZoneLow,
      entryZoneHigh: trade.entryZoneHigh,
      executionMode: trade.executionMode,
    },
  });

  return closedTrade;
}

async function refreshTradezPaperTrades(state, candidates) {
  if (!state.openTrades.length) return;
  const candidateLookup = new Map(candidates.map((candidate) => [candidate.symbol, candidate]));
  for (const trade of [...state.openTrades]) {
    const candidate = candidateLookup.get(trade.symbol);
    if (!candidate) continue;
    trade.lastPrice = candidate.currentPrice;
    trade.pricePrecision = candidate.pricePrecision;
    const currentPrice = candidate.currentPrice;
    const liveMarginPct = tradezPaperReturnPct(trade, currentPrice);
    const hitTp1 =
      !trade.tp1Hit &&
      ((trade.side === "Long" ? currentPrice >= trade.tp1 : currentPrice <= trade.tp1) ||
        liveMarginPct >= 25);
    const hitTp2 = trade.side === "Long" ? currentPrice >= trade.tp2 : currentPrice <= trade.tp2;
    const hitStop = trade.side === "Long" ? currentPrice <= trade.stopLoss : currentPrice >= trade.stopLoss;

    if (hitTp1) {
      trade.tp1Hit = true;
      trade.stopLoss = trade.entryPrice;
      trade.currentTarget = trade.tp2;
      logActivity(
        state,
        `${trade.symbol} hit TP1. Stop moved to entry while the runner targets ${formatPrice(
          trade.tp2,
          candidate.pricePrecision
        )}.`,
        trade.side === "Long" ? "up" : "down"
      );
      await safeInsertTradeEvent({
        eventId: `${trade.id}:tp1:${Date.now()}`,
        tradeId: trade.id,
        source: "server",
        strategy: "ema_book",
        strategyVersion: TRADEZ_AUTO_VERSION,
        eventType: "tp1_hit",
        symbol: trade.symbol,
        side: trade.side,
        eventTime: Date.now(),
        detectedAt: trade.detectedAt,
        openedAt: trade.openedAt,
        entryPrice: trade.entryPrice,
        tp1: trade.tp1,
        tp2: trade.tp2,
        stopLoss: trade.stopLoss,
        leverage: trade.leverage,
        quantity: trade.quantity,
        marginUsed: trade.marginUsed,
        qualityScore: trade.qualityScore,
        metadata: {
          exitType: "tp1",
          runnerTarget: trade.tp2,
          triggeredByMarginPct: liveMarginPct >= 25 ? liveMarginPct : null,
        },
      });
    }

    if (hitTp2) {
      await closeTradezPaperTrade(state, trade.id, "TP", trade.tp2, candidate.pricePrecision);
    } else if (hitStop) {
      const closeReason = trade.tp1Hit ? "BE" : "SL";
      await closeTradezPaperTrade(state, trade.id, closeReason, trade.stopLoss, candidate.pricePrecision);
    }
  }
}

async function openTradezQualifiedTrades(state, candidates) {
  const eligible = highQualityTradezAutoCandidates(candidates, state.qualityThreshold).filter(
    (candidate) => !tradezPaperHasOpenTrade(state, candidate.symbol) && !tradezPaperRecentlyClosed(state, candidate.symbol)
  );
  const opened = [];
  for (const candidate of eligible) {
    if (opened.length >= TRADEZ_AUTO_MAX_NEW_TRADES) break;
    if (state.openTrades.length >= TRADEZ_AUTO_MAX_CONCURRENT_TRADES) break;
    if (await openTradezPaperTrade(state, candidate)) opened.push(candidate);
  }
  return opened;
}

async function runTradezScan(stateInput = {}, options = {}) {
  const state = sanitizeRuntimeState(stateInput);
  const manual = Boolean(options.manual);
  const previousStatusTone = state.lastStatusTone;
  const previousActivityTone = state.activity[0]?.tone || "neutral";

  try {
    const universe = await getPerpUniverse();
    const tickers = await fetchUniverseTickers();
    universeTickerMap = buildTickerLookup(tickers);
    const batch = selectUniverseBatch(universe, state);

    const analyses = await mapWithConcurrency(batch, ANALYSIS_CONCURRENCY, async (symbolInfo) => {
      try {
        const snapshot = await fetchDirectSnapshot(symbolInfo.symbol);
        const ticker = universeTickerMap.get(symbolInfo.symbol) || {};
        return buildTradezSignals(snapshot, ticker.quoteVolume || Number(snapshot.ticker?.quoteVolume) || 0);
      } catch (error) {
        return null;
      }
    });

    const scanIdentifiedAt = Date.now();
    const priorSignalTimes = new Map(
      state.lastCandidates
        .filter((candidate) => candidate?.activeSignal?.id)
        .map((candidate) => [candidate.activeSignal.id, candidate.identifiedAt || candidate.activeSignal.detectedAt])
    );

    analyses.forEach((candidate) => {
      if (!candidate?.activeSignal) return;
      const preservedIdentifiedAt = priorSignalTimes.get(candidate.activeSignal.id);
      candidate.identifiedAt = preservedIdentifiedAt || scanIdentifiedAt;
    });

    const analyzedCandidates = analyses.filter(Boolean);
    state.lastCandidates = analyzedCandidates
      .filter((candidate) => candidate.activeSignal && candidate.activeSignal.sinceTouchBars <= MAX_STALE_SIGNAL_BARS)
      .sort((left, right) => right.qualityScore - left.qualityScore)
      .slice(0, 28)
      .map(sanitizeCandidate);
    state.lastScanAt = Date.now();

    await refreshTradezPaperTrades(state, analyzedCandidates);
    const openedTrades = state.autoEnabled ? await openTradezQualifiedTrades(state, state.lastCandidates) : [];

    const best = state.lastCandidates[0];
    if (openedTrades.length) {
      const lead = openedTrades[0];
      setRuntimeStatus(
        state,
        `Opened ${openedTrades.length} new EMA Signals trade${openedTrades.length > 1 ? "s" : ""}. ${state.openTrades.length}/${TRADEZ_AUTO_MAX_CONCURRENT_TRADES} Auto Trade 2 positions are active, led by ${lead.symbol}.`,
        lead.activeSignal?.tone || "up"
      );
    } else if (best) {
      setRuntimeStatus(
        state,
        `${state.lastCandidates.filter((candidate) => candidate.qualityScore >= state.qualityThreshold).length} Tradez setups qualified. ${best.symbol} leads with Q${best.qualityScore}.`,
        "up"
      );
    } else {
      setRuntimeStatus(state, "Tradez scan complete. No setup currently clears the active quality filter.", "neutral");
    }

    if ((previousStatusTone === "down" || previousActivityTone === "down") && state.lastStatusTone !== "down") {
      logActivity(state, `Tradez runtime recovered • ${state.lastStatusMessage}`, state.lastStatusTone);
    }

    return {
      state: sanitizeRuntimeState(state),
      summary: {
        ok: true,
        checkedUniverse: universe.length,
        scannedBatch: batch.length,
        qualified: state.lastCandidates.length,
        opened: openedTrades.length,
        activeTrades: state.openTrades.length,
        lastScanAt: state.lastScanAt,
        manual,
      },
    };
  } catch (error) {
    setRuntimeStatus(state, error.message || "Tradez background scan failed.", "down");
    logActivity(state, `Tradez background scan failed • ${error.message || "Unknown error"}`, "down");
    return {
      state: sanitizeRuntimeState(state),
      summary: {
        ok: false,
        error: error.message || "Tradez background scan failed.",
      },
    };
  }
}

module.exports = {
  defaultRuntimeState,
  sanitizeRuntimeState,
  buildResetRuntimeState,
  applyRuntimeSettings,
  getPerpUniverse,
  fetchDirectSnapshot,
  buildTradezSignals,
  runTradezScan,
};
