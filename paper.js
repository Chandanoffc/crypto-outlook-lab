const STRATEGY_SPECS = [
  { id: "core", label: "House Trend", shortLabel: "House", tone: "up", maxOpenTrades: 6 },
];
const STRATEGY_START_BALANCE = 200;
const START_BALANCE = STRATEGY_START_BALANCE;
const DEFAULT_INTERVAL = "15m";
const DEFAULT_QUALITY_THRESHOLD = 68;
const QUOTE_ASSET = "USDT";
const AUTO_SCAN_MS = 90 * 1000;
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
const HIGH_VOLUME_FLOOR = 100_000_000;
const MIN_RR = 1.6;
const MIN_PROJECTED_MOVE_PCT = 2.1;
const STRATEGY_VERSION = 5;
const TICKER_STORAGE_KEY = "apex-signals-auto-paper-tickers";
const TICKER_CACHE_MAX_AGE_MS = 30 * 60 * 1000;
const HTF_CONFIRMATION_CONFIG = [
  { key: "1h", label: "1H", interval: "1h" },
  { key: "4h", label: "4H", interval: "4h" },
];
const STORAGE_KEY = "apex-signals-auto-paper";

const dom = {
  autoForm: document.getElementById("auto-form"),
  universeInput: document.getElementById("universe-input"),
  scanInterval: document.getElementById("scan-interval"),
  qualityThreshold: document.getElementById("quality-threshold"),
  universeCount: document.getElementById("universe-count"),
  scanButton: document.getElementById("scan-button"),
  autoToggleButton: document.getElementById("auto-toggle-button"),
  resetSimButton: document.getElementById("reset-sim-button"),
  autoRunNote: document.getElementById("auto-run-note"),
  statusBanner: document.getElementById("paper-status-banner"),
  metricStartBalance: document.getElementById("metric-start-balance"),
  metricCurrentEquity: document.getElementById("metric-current-equity"),
  metricCurrentNote: document.getElementById("metric-current-note"),
  metricRealizedPnl: document.getElementById("metric-realized-pnl"),
  metricRealizedNote: document.getElementById("metric-realized-note"),
  metricWinRate: document.getElementById("metric-win-rate"),
  metricWinRateNote: document.getElementById("metric-win-rate-note"),
  metricOpenTrade: document.getElementById("metric-open-trade"),
  metricOpenNote: document.getElementById("metric-open-note"),
  metricLastScan: document.getElementById("metric-last-scan"),
  metricLastScanNote: document.getElementById("metric-last-scan-note"),
  strategySleeveGrid: document.getElementById("strategy-sleeve-grid"),
  marketTable: document.getElementById("market-table"),
  paperTabPositions: document.getElementById("paper-tab-positions"),
  paperTabTrades: document.getElementById("paper-tab-trades"),
  paperTabActivity: document.getElementById("paper-tab-activity"),
  paperTabNote: document.getElementById("paper-tab-note"),
  paperPanelPositions: document.getElementById("paper-panel-positions"),
  paperPanelTrades: document.getElementById("paper-panel-trades"),
  paperPanelActivity: document.getElementById("paper-panel-activity"),
  openPositionGrid: document.getElementById("open-position-grid"),
  tradeLogTable: document.getElementById("trade-log-table"),
  activityTable: document.getElementById("activity-table"),
};

const state = loadState();
let autoTimer = null;
let exchangeInfoCache = null;
let perpUniverseCache = null;
let scanning = false;
let universeTickerMap = new Map();
let analysisCache = new Map();
let confirmationCache = new Map();
let scanCursor = 0;

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

function recomputeTotalBalance() {
  state.balance = STRATEGY_SPECS.reduce(
    (sum, spec) => sum + (Number(state.strategyBalances?.[spec.id]) || 0),
    0
  );
}

function strategySpec(strategyId) {
  return STRATEGY_SPECS.find((spec) => spec.id === strategyId) || STRATEGY_SPECS[0];
}

function loadState() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    const strategyBalances = normalizeStrategyBalances(stored.strategyBalances);
    const openTrades = Array.isArray(stored.openTrades)
      ? stored.openTrades.map((trade) => ({
          ...trade,
          strategyId: trade.strategyId || "core",
          strategyLabel: trade.strategyLabel || strategySpec(trade.strategyId || "core").label,
        }))
      : stored.openTrade
        ? [
            {
              ...stored.openTrade,
              strategyId: "core",
              strategyLabel: strategySpec("core").label,
            },
          ]
        : [];
    const closedTrades = Array.isArray(stored.closedTrades)
      ? stored.closedTrades.map((trade) => ({
          ...trade,
          strategyId: trade.strategyId || "core",
          strategyLabel: trade.strategyLabel || strategySpec(trade.strategyId || "core").label,
        }))
      : [];
    return {
      startingBalance: START_BALANCE,
      balance: STRATEGY_SPECS.reduce((sum, spec) => sum + (Number(strategyBalances[spec.id]) || 0), 0),
      strategyBalances,
      autoEnabled: stored.autoEnabled !== false,
      interval: stored.interval || DEFAULT_INTERVAL,
      qualityThreshold: Number(stored.qualityThreshold) || DEFAULT_QUALITY_THRESHOLD,
      openTrades,
      strategyVersion: Number(stored.strategyVersion) || 1,
      activeTab: stored.activeTab || "positions",
      closedTrades,
      activity: Array.isArray(stored.activity) ? stored.activity : [],
      lastCandidates: Array.isArray(stored.lastCandidates) ? stored.lastCandidates : [],
      lastScanAt: Number(stored.lastScanAt) || 0,
    };
  } catch (error) {
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
    };
  }
}

function persistState() {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      balance: state.balance,
      strategyBalances: state.strategyBalances,
      autoEnabled: state.autoEnabled,
      interval: state.interval,
      qualityThreshold: state.qualityThreshold,
      openTrades: state.openTrades,
      strategyVersion: state.strategyVersion,
      activeTab: state.activeTab,
      closedTrades: state.closedTrades,
      activity: state.activity,
      lastCandidates: state.lastCandidates,
      lastScanAt: state.lastScanAt,
    })
  );
}

function readStoredJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function writeStoredJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Ignore storage failures in degraded browser environments.
  }
}

function getFallbackExchangeInfo() {
  const fallback = window.APEX_FALLBACK_PERPS;
  if (!fallback || !Array.isArray(fallback.symbols) || !fallback.symbols.length) return null;
  return fallback;
}

function setStatus(message, tone = "neutral") {
  dom.statusBanner.textContent = message;
  dom.statusBanner.className = `status-banner ${tone}`;
}

function renderPaperTabs() {
  if (
    !dom.paperTabPositions ||
    !dom.paperTabTrades ||
    !dom.paperTabActivity ||
    !dom.paperPanelPositions ||
    !dom.paperPanelTrades ||
    !dom.paperPanelActivity
  ) {
    return;
  }

  dom.paperTabPositions.classList.toggle("is-active", state.activeTab === "positions");
  dom.paperTabTrades.classList.toggle("is-active", state.activeTab === "trades");
  dom.paperTabActivity.classList.toggle("is-active", state.activeTab === "activity");
  dom.paperPanelPositions.hidden = state.activeTab !== "positions";
  dom.paperPanelTrades.hidden = state.activeTab !== "trades";
  dom.paperPanelActivity.hidden = state.activeTab !== "activity";

  if (dom.paperTabNote) {
    dom.paperTabNote.textContent =
      state.activeTab === "positions"
        ? "This view keeps live paper positions visible with entry, TP, SL, and live return."
        : state.activeTab === "trades"
          ? "The journal records every closed trade with the planned levels and realized result."
          : "Engine actions show scan outcomes, openings, exits, and network retries in sequence.";
  }
}

function friendlyErrorMessage(error) {
  const message = error?.message || String(error || "");
  if (/failed to fetch/i.test(message)) {
    return "Network request failed during the scan. The engine will retry automatically.";
  }
  return message || "Auto trader scan failed.";
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
  const symbols = (exchangeInfo.symbols || []).filter(
    (symbolInfo) =>
      symbolInfo.quoteAsset === QUOTE_ASSET &&
      symbolInfo.contractType === "PERPETUAL" &&
      symbolInfo.status === "TRADING"
  );

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

function withinPercent(reference, price, pct) {
  if (!Number.isFinite(reference) || !Number.isFinite(price) || !reference) return false;
  return Math.abs((price - reference) / reference) * 100 <= pct;
}

function findPivotIndices(candles, direction, startIndex = 2, endIndex = candles.length - 3) {
  const pivots = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    const current = candles[index];
    const previous = candles.slice(index - 2, index);
    const next = candles.slice(index + 1, index + 3);
    if (direction === "low") {
      if (previous.every((item) => current.low <= item.low) && next.every((item) => current.low <= item.low)) {
        pivots.push(index);
      }
    } else if (
      previous.every((item) => current.high >= item.high) &&
      next.every((item) => current.high >= item.high)
    ) {
      pivots.push(index);
    }
  }
  return pivots;
}

function detectRecentDivergence(candles, rsiSeries, direction) {
  const pivots = findPivotIndices(candles, direction === "bullish" ? "low" : "high");
  if (pivots.length < 2) return null;

  for (let index = pivots.length - 1; index >= 1; index -= 1) {
    const currentIndex = pivots[index];
    const previousIndex = pivots[index - 1];
    if (candles.length - 1 - currentIndex > 18) continue;

    const currentCandle = candles[currentIndex];
    const previousCandle = candles[previousIndex];
    const currentRsi = rsiSeries[currentIndex];
    const previousRsi = rsiSeries[previousIndex];
    if (!Number.isFinite(currentRsi) || !Number.isFinite(previousRsi)) continue;

    if (
      direction === "bullish" &&
      currentCandle.low < previousCandle.low &&
      currentRsi > previousRsi + 2
    ) {
      return { pivotIndex: currentIndex, previousIndex, currentCandle };
    }

    if (
      direction === "bearish" &&
      currentCandle.high > previousCandle.high &&
      currentRsi < previousRsi - 2
    ) {
      return { pivotIndex: currentIndex, previousIndex, currentCandle };
    }
  }

  return null;
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

function buildPotentialTrade(context) {
  const supportLevels = [...context.supportLevels].filter(Boolean).sort((left, right) => right - left);
  const resistanceLevels = [...context.resistanceLevels].filter(Boolean).sort((left, right) => left - right);
  const tone = context.bias.tone === "neutral" ? (context.cvdSlope >= 0 ? "up" : "down") : context.bias.tone;
  const stance = tone === "down" ? "Short" : "Long";
  const entry = context.currentPrice;
  const leverage = DEFAULT_LEVERAGE;
  const targetReturnPct = TARGET_MARGIN_RETURN_PCT;
  const stopReturnPct = STOP_MARGIN_RETURN_PCT;
  const riskUnit = Math.max(context.latestAtr * 0.9, context.currentPrice * 0.006);
  const bandBuffer = Math.max(context.bandWidth || 0, riskUnit * 0.18);
  const targetMove = Math.max(entry * (targetReturnPct / leverage / 100), riskUnit * 1.4);
  const stopMove = Math.max(entry * (stopReturnPct / leverage / 100), riskUnit * 0.75);
  let stopLoss;
  let takeProfit;

  if (tone === "up") {
    const nearestSupport = supportLevels.find((level) => level < entry) ?? entry - riskUnit;
    const nearestResistance = resistanceLevels.find((level) => level > entry) ?? entry + riskUnit * 1.2;
    stopLoss = Math.max(nearestSupport - bandBuffer, entry - stopMove);
    takeProfit = Math.max(nearestResistance, entry + targetMove);
  } else {
    const nearestResistance = resistanceLevels.find((level) => level > entry) ?? entry + riskUnit;
    const nearestSupport = supportLevels.find((level) => level < entry) ?? entry - riskUnit * 1.2;
    stopLoss = Math.min(nearestResistance + bandBuffer, entry + stopMove);
    takeProfit = Math.min(nearestSupport, entry - targetMove);
  }

  const rr = Math.abs(takeProfit - entry) / Math.max(Math.abs(entry - stopLoss), 0.0000001);
  return {
    stance,
    tone,
    entry,
    stopLoss,
    takeProfit,
    rr,
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
  const venueConsensus = buildVenueConsensus(snapshot.venues || []);
  const biasScore = buildBiasScore({
    currentPrice,
    ema20: latestDefinedValue(ema20Series) ?? currentPrice,
    ema50: latestDefinedValue(ema50Series) ?? currentPrice,
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
  const potentialTrade = buildPotentialTrade({
    currentPrice,
    latestAtr,
    bandWidth: supportResistance.bandWidth,
    supportLevels: supportResistance.supportLevels,
    resistanceLevels: supportResistance.resistanceLevels,
    bias,
    cvdSlope: tradeSummary.cvdSlope,
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
    candles,
    closes,
    rsiSeries,
    ema20Series,
    ema50Series,
    bollingerSeries,
    ema20: latestDefinedValue(ema20Series) ?? currentPrice,
    ema50: latestDefinedValue(ema50Series) ?? currentPrice,
    rsi: latestDefinedValue(rsiSeries) ?? 50,
    latestAtr,
    fundingRate,
    quoteVolume,
    oiChange1h,
    recentPriceChange,
    cvdSlope: tradeSummary.cvdSlope,
    depthImbalance: depthSummary.imbalance,
    takerRatio: takerSummary.latestRatio,
    globalLongShortRatio,
    venueConsensus,
    supportResistance,
    tradeSummary,
    depthSummary,
    takerSummary,
    trade: potentialTrade,
    summary: `${bias.label} bias • Q${qualityScore} • RR ${rr.toFixed(2)} • funding ${fundingRate.toFixed(4)}%`,
    strategySignals: {},
    bestStrategyQuality: qualityScore,
  };
}

function highQualityCandidates(candidates, threshold) {
  return candidates
    .filter(
      (candidate) =>
        candidate.bias.tone !== "neutral" &&
        (candidate.refinedQualityScore ?? candidate.qualityScore) >= threshold + 10 &&
        candidate.entryQualityScore >= 16 &&
        candidate.alignedCount >= 2 &&
        candidate.conflictCount === 0 &&
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

function formatPrice(value, digits = 2) {
  if (!Number.isFinite(value)) return "-";
  const maxDigits = value >= 1000 ? 2 : value >= 1 ? Math.max(2, digits) : Math.max(4, digits);
  return `$${Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.min(maxDigits, 8),
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

function formatCompactNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: digits,
  }).format(value);
}

function toneFromNumber(value, flatBand = 0.02) {
  if (!Number.isFinite(value)) return "neutral";
  if (value > flatBand) return "up";
  if (value < -flatBand) return "down";
  return "neutral";
}

function renderAnalysisGrid(container, items) {
  if (!container) return;
  container.innerHTML = "";
  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "analysis-card";
    card.innerHTML = `
      <span>${item.label}</span>
      <strong class="${item.tone || "neutral"}">${item.value}</strong>
      <small>${item.note}</small>
    `;
    container.appendChild(card);
  });
}

function renderTable(container, rows, emptyText) {
  if (!container) return;
  container.innerHTML = "";
  if (!rows.length) {
    const row = document.createElement("div");
    row.className = "table-row";
    row.innerHTML = `
      <div><span>Status</span><strong>${emptyText}</strong></div>
      <div><span>-</span><strong>-</strong></div>
      <div><span>-</span><strong>-</strong></div>
    `;
    container.appendChild(row);
    return;
  }

  rows.forEach((row) => {
    const element = document.createElement("div");
    element.className = "table-row";
    element.innerHTML = `
      <div>
        <span>${row.label}</span>
        <strong class="${row.tone || "neutral"}">${row.primary}</strong>
      </div>
      <div>
        <span>${row.secondaryLabel}</span>
        <strong>${row.secondary}</strong>
      </div>
      <div>
        <span>${row.tertiaryLabel}</span>
        <strong>${row.tertiary}</strong>
      </div>
    `;
    container.appendChild(element);
  });
}

async function fetchJson(url, label) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${label} failed (${response.status})`);
  return response.json();
}

async function fetchServerSnapshot(token, interval) {
  const url = new URL("/api/market", window.location.origin);
  url.searchParams.set("token", normalizeToken(token));
  url.searchParams.set("interval", interval);
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Server snapshot failed");
  return payload;
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

function loadStoredTickers(activeSymbols) {
  const stored = readStoredJson(TICKER_STORAGE_KEY, null);
  if (!stored || !Array.isArray(stored.tickers) || !stored.savedAt) return null;
  if (Date.now() - Number(stored.savedAt) > TICKER_CACHE_MAX_AGE_MS) return null;
  return mapUniverseTickers(stored.tickers, activeSymbols);
}

function persistTickers(tickers) {
  writeStoredJson(TICKER_STORAGE_KEY, {
    savedAt: Date.now(),
    tickers,
  });
}

function mergeTickerLists(primary, secondary) {
  const merged = new Map();
  (primary || []).forEach((ticker) => {
    if (ticker?.symbol) merged.set(ticker.symbol, ticker);
  });
  (secondary || []).forEach((ticker) => {
    if (ticker?.symbol && !merged.has(ticker.symbol)) {
      merged.set(ticker.symbol, ticker);
    }
  });
  return Array.from(merged.values());
}

async function fetchUniverseTickersDirect(activeSymbols) {
  const tickers = await fetchJson("https://fapi.binance.com/fapi/v1/ticker/24hr", "24H tickers");
  return mapUniverseTickers(tickers, activeSymbols);
}

async function fetchUniverseTickersServer(activeSymbols) {
  const response = await fetch(new URL("/api/arena-universe", window.location.origin));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Arena universe proxy failed (${response.status})`);
  }
  return {
    tickers: mapUniverseTickers(payload.tickers || [], activeSymbols),
    source: payload.source || "server proxy",
    degraded: Boolean(payload.degraded),
    warning: payload.warning || "",
  };
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
  const cachedTickers = loadStoredTickers(activeSymbols);
  try {
    const tickers = await fetchUniverseTickersDirect(activeSymbols);
    persistTickers(tickers);
    return tickers;
  } catch (directError) {
    try {
      const serverResult = await fetchUniverseTickersServer(activeSymbols);
      const serverTickers = serverResult.tickers || [];
      if (serverTickers.some((entry) => entry.quoteVolume > 0) || !serverResult.degraded) {
        if (serverTickers.length) persistTickers(serverTickers);
        return serverTickers;
      }

      const spotTickers = await fetchUniverseSpotTickersFallback(activeSymbols).catch(() => []);
      const blendedTickers = mergeTickerLists(spotTickers, cachedTickers || serverTickers);
      if (blendedTickers.length) {
        persistTickers(blendedTickers);
        return blendedTickers;
      }

      if (cachedTickers?.length) {
        return cachedTickers;
      }

      return serverTickers;
    } catch (serverError) {
      if (cachedTickers?.some((entry) => entry.quoteVolume > 0)) {
        return cachedTickers;
      }

      const spotTickers = await fetchUniverseSpotTickersFallback(activeSymbols).catch(() => []);
      if (spotTickers.length) {
        persistTickers(spotTickers);
        return spotTickers;
      }

      if (cachedTickers?.length) {
        return cachedTickers;
      }

      try {
        return await fetchUniversePricesFallback(activeSymbols);
      } catch (priceError) {
        return buildShellTickers(activeSymbols);
      }
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
      // Try the next candidate.
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

async function fetchSnapshotWithFallback(token, interval) {
  try {
    return await fetchServerSnapshot(token, interval);
  } catch (error) {
    return fetchDirectSnapshot(token, interval);
  }
}

async function fetchEngineSnapshot(token, interval) {
  try {
    return await fetchDirectSnapshot(token, interval);
  } catch (error) {
    return fetchServerSnapshot(token, interval);
  }
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

function applyCandidateConfirmation(candidate, ticker, confirmation) {
  const quoteVolume = ticker?.quoteVolume || 0;
  const direction = candidate.bias.tone;
  const alignedTone = direction === "up" ? "up" : "down";
  const opposingTone = alignedTone === "up" ? "down" : "up";
  const timeframeStates = Object.values(confirmation || {});
  const alignedCount = timeframeStates.filter((entry) => entry.tone === alignedTone).length;
  const conflictCount = timeframeStates.filter((entry) => entry.tone === opposingTone).length;
  const distanceFromEma20Pct = Math.abs(pctChange(candidate.ema20, candidate.currentPrice));
  let entryQualityScore = 0;

  if (hasGoodTradingVolume(quoteVolume)) entryQualityScore += 10;
  else entryQualityScore -= 14;

  if (direction === "up") {
    entryQualityScore += candidate.rsi >= 52 && candidate.rsi <= 64 ? 8 : -8;
    entryQualityScore += candidate.cvdSlope > 0 ? 8 : -10;
    entryQualityScore += candidate.takerRatio > 1.01 ? 6 : -6;
    entryQualityScore += candidate.depthImbalance > 0.02 ? 5 : -5;
    entryQualityScore += candidate.oiChange1h > 0 ? 5 : -3;
    if (candidate.fundingRate > 0.03) entryQualityScore -= 8;
  } else {
    entryQualityScore += candidate.rsi <= 48 && candidate.rsi >= 34 ? 8 : -8;
    entryQualityScore += candidate.cvdSlope < 0 ? 8 : -10;
    entryQualityScore += candidate.takerRatio < 0.99 ? 6 : -6;
    entryQualityScore += candidate.depthImbalance < -0.02 ? 5 : -5;
    entryQualityScore += candidate.oiChange1h > 0 ? 5 : -3;
    if (candidate.fundingRate < -0.03) entryQualityScore -= 8;
  }

  entryQualityScore += alignedCount >= 2 ? 16 : -20;
  if (conflictCount > 0) entryQualityScore -= 10;
  entryQualityScore += distanceFromEma20Pct <= 2.8 ? 4 : -8;
  entryQualityScore += Math.abs(candidate.recentPriceChange) >= 0.8 ? 3 : -3;

  return {
    ...candidate,
    quoteVolume,
    confirmation,
    alignedCount,
    conflictCount,
    entryQualityScore,
    refinedQualityScore: candidate.qualityScore + entryQualityScore,
  };
}

function buildStrategySignal({
  strategyId,
  side,
  tone,
  qualityScore,
  detectedAt,
  entry,
  stopLoss,
  takeProfit,
  leverage,
  note,
  reason,
}) {
  const rr = Math.abs(takeProfit - entry) / Math.max(Math.abs(entry - stopLoss), 0.0000001);
  return {
    id: `${strategyId}:${side}:${detectedAt}:${entry}`,
    strategyId,
    strategyLabel: strategySpec(strategyId).label,
    side,
    tone,
    qualityScore: Math.max(0, Math.round(qualityScore)),
    detectedAt,
    entry,
    stopLoss,
    takeProfit,
    rr,
    leverage,
    projectedMovePct: Math.abs(pctChange(entry, takeProfit)),
    targetReturnPct: Math.abs(pctChange(entry, takeProfit)) * leverage,
    stopReturnPct: Math.abs(pctChange(entry, stopLoss)) * leverage,
    note,
    reason,
  };
}

function buildCoreTrendStrategySignal(candidate) {
  if (
    candidate.bias.tone === "neutral" ||
    candidate.alignedCount < 2 ||
    candidate.conflictCount > 0 ||
    !hasGoodTradingVolume(candidate.quoteVolume) ||
    candidate.rr < MIN_RR
  ) {
    return null;
  }

  return buildStrategySignal({
    strategyId: "core",
    side: candidate.trade.stance,
    tone: candidate.trade.tone,
    qualityScore: candidate.refinedQualityScore ?? candidate.qualityScore,
    detectedAt: Date.now(),
    entry: candidate.trade.entry,
    stopLoss: candidate.trade.stopLoss,
    takeProfit: candidate.trade.takeProfit,
    leverage: candidate.trade.leverage || DEFAULT_LEVERAGE,
    note: "Trend stack, flow confirmation, and higher-timeframe alignment all support continuation.",
    reason: `${candidate.bias.label} • RR ${candidate.rr.toFixed(2)} • 1H ${candidate.confirmation?.["1h"]?.label || "Queue"} • 4H ${candidate.confirmation?.["4h"]?.label || "Queue"}`,
  });
}

function buildLiquidationMagnetStrategySignal(candidate) {
  const candles = candidate.candles || [];
  if (candles.length < 30) return null;

  const recent = candles.slice(-18);
  const avgVolume = average(candles.slice(-21, -1).map((entry) => entry.volume).filter(Boolean)) || 1;
  const bullishDiv = detectRecentDivergence(candles, candidate.rsiSeries || [], "bullish");
  const bearishDiv = detectRecentDivergence(candles, candidate.rsiSeries || [], "bearish");
  const nearestSupport = candidate.supportResistance?.supportLevels?.[0];
  const nearestResistance = candidate.supportResistance?.resistanceLevels?.[0];

  const sweepCandidates = recent
    .map((candle, index) => ({ candle, index: candles.length - recent.length + index }))
    .filter((entry) => entry.index >= candles.length - 10);

  const bestLongSweep = sweepCandidates
    .filter((entry) => lowerWickRatio(entry.candle) >= 0.45)
    .sort((left, right) => lowerWickRatio(right.candle) - lowerWickRatio(left.candle))[0];
  const bestShortSweep = sweepCandidates
    .filter((entry) => upperWickRatio(entry.candle) >= 0.45)
    .sort((left, right) => upperWickRatio(right.candle) - upperWickRatio(left.candle))[0];

  const longValid =
    bullishDiv &&
    bestLongSweep &&
    withinPercent(nearestSupport, bullishDiv.currentCandle.low, 1.0) &&
    candidate.currentPrice > (nearestSupport || candidate.currentPrice) &&
    candidate.cvdSlope >= 0 &&
    Math.max(bestLongSweep.candle.volume, bullishDiv.currentCandle.volume) >= avgVolume * 1.25;

  const shortValid =
    bearishDiv &&
    bestShortSweep &&
    withinPercent(nearestResistance, bearishDiv.currentCandle.high, 1.0) &&
    candidate.currentPrice < (nearestResistance || candidate.currentPrice) &&
    candidate.cvdSlope <= 0 &&
    Math.max(bestShortSweep.candle.volume, bearishDiv.currentCandle.volume) >= avgVolume * 1.25;

  if (!longValid && !shortValid) return null;

  const side = longValid ? "Long" : "Short";
  const tone = longValid ? "up" : "down";
  const sweepCandle = longValid ? bullishDiv.currentCandle : bearishDiv.currentCandle;
  const entry = candidate.currentPrice;
  const baseStop =
    side === "Long"
      ? Math.min(sweepCandle.low, nearestSupport || sweepCandle.low) - Math.max(candidate.latestAtr * 0.14, entry * 0.0012)
      : Math.max(sweepCandle.high, nearestResistance || sweepCandle.high) + Math.max(candidate.latestAtr * 0.14, entry * 0.0012);
  const stopLoss =
    side === "Long"
      ? Math.min(baseStop, entry * (1 - 0.0045))
      : Math.max(baseStop, entry * (1 + 0.0045));
  const fallbackTarget = side === "Long" ? entry * 1.018 : entry * 0.982;
  const takeProfit =
    side === "Long"
      ? Math.max(fallbackTarget, nearestResistance || fallbackTarget)
      : Math.min(fallbackTarget, nearestSupport || fallbackTarget);
  const movePct = Math.abs(pctChange(entry, takeProfit));
  if (movePct < 0.9) return null;

  let qualityScore = 60;
  qualityScore += side === "Long" ? 8 : 8;
  qualityScore += Math.round((longValid ? lowerWickRatio(sweepCandle) : upperWickRatio(sweepCandle)) * 24);
  qualityScore += Math.max(0, Math.round((Math.max(sweepCandle.volume / avgVolume, 1) - 1) * 14));
  qualityScore += side === "Long" ? (candidate.rsi <= 42 ? 8 : 0) : candidate.rsi >= 58 ? 8 : 0;
  qualityScore += side === "Long" ? (candidate.fundingRate > 0 ? 4 : 0) : candidate.fundingRate < 0 ? 4 : 0;
  qualityScore += side === "Long" ? (candidate.oiChange1h < 0 ? 4 : 0) : candidate.oiChange1h < 0 ? 4 : 0;

  return buildStrategySignal({
    strategyId: "liq",
    side,
    tone,
    qualityScore,
    detectedAt: sweepCandle.time * 1000,
    entry,
    stopLoss,
    takeProfit,
    leverage: 8,
    note: "Proxy liquidation sweep: wick + RSI divergence + reclaim near clustered support/resistance.",
    reason: `${side === "Long" ? "Downside" : "Upside"} sweep reclaimed • wick trap confirmed • ${formatPercent(movePct)} target move`,
  });
}

function buildObFvgStrategySignal(candidate) {
  const candles = candidate.candles || [];
  if (candles.length < 40) return null;

  const bodies = candles.map(candleBody);
  const volumes = candles.map((candle) => candle.volume);
  let bestSignal = null;

  for (let index = Math.max(22, candles.length - 32); index < candles.length - 2; index += 1) {
    const first = candles[index - 1];
    const displacement = candles[index];
    const third = candles[index + 1];
    const avgBody = average(bodies.slice(index - 20, index)) || candleBody(displacement);
    const avgVolume = average(volumes.slice(index - 20, index)) || displacement.volume;
    const bullishDisplacement =
      displacement.close > displacement.open &&
      candleBody(displacement) >= avgBody * 2 &&
      displacement.volume >= avgVolume * 1.2 &&
      first.high < third.low;
    const bearishDisplacement =
      displacement.close < displacement.open &&
      candleBody(displacement) >= avgBody * 2 &&
      displacement.volume >= avgVolume * 1.2 &&
      first.low > third.high;

    if (!bullishDisplacement && !bearishDisplacement) continue;

    const side = bullishDisplacement ? "Long" : "Short";
    const tone = bullishDisplacement ? "up" : "down";
    const gapLow = bullishDisplacement ? first.high : third.high;
    const gapHigh = bullishDisplacement ? third.low : first.low;
    const equilibrium = average([gapLow, gapHigh]);
    const blockWindow = candles.slice(Math.max(0, index - 4), index);
    const orderBlock = [...blockWindow]
      .reverse()
      .find((candle) => (bullishDisplacement ? candle.close < candle.open : candle.close > candle.open));
    if (!orderBlock) continue;

    let retestIndex = -1;
    for (let cursor = index + 2; cursor < candles.length; cursor += 1) {
      const retest = candles[cursor];
      if (retest.low <= gapHigh && retest.high >= gapLow) {
        retestIndex = cursor;
      }
    }
    if (retestIndex === -1 || candles.length - 1 - retestIndex > 5) continue;

    const currentPrice = candidate.currentPrice;
    const zoneTolerance = Math.max(candidate.latestAtr * 0.1, currentPrice * 0.0012);
    const priceNearZone =
      currentPrice >= Math.min(gapLow, gapHigh) - zoneTolerance &&
      currentPrice <= Math.max(gapLow, gapHigh) + zoneTolerance;
    if (!priceNearZone) continue;

    const stopLoss =
      side === "Long"
        ? Math.min(orderBlock.low, gapLow) - candidate.latestAtr * 0.16
        : Math.max(orderBlock.high, gapHigh) + candidate.latestAtr * 0.16;
    const targetReference =
      side === "Long"
        ? candidate.supportResistance?.resistanceLevels?.[0] || currentPrice + candidate.latestAtr * 2.2
        : candidate.supportResistance?.supportLevels?.[0] || currentPrice - candidate.latestAtr * 2.2;
    const takeProfit =
      side === "Long"
        ? Math.max(targetReference, equilibrium + candidate.latestAtr * 1.9)
        : Math.min(targetReference, equilibrium - candidate.latestAtr * 1.9);
    const rr = Math.abs(takeProfit - equilibrium) / Math.max(Math.abs(equilibrium - stopLoss), 0.0000001);
    if (rr < 1.3) continue;

    let qualityScore = 58;
    qualityScore += candidate.alignedCount >= 2 ? 12 : -10;
    qualityScore += candleBody(displacement) >= avgBody * 2.5 ? 10 : 6;
    qualityScore += displacement.volume >= avgVolume * 1.5 ? 10 : 4;
    qualityScore += candidate.bias.tone === tone ? 10 : -8;
    qualityScore += candidate.entryQualityScore >= 16 ? 8 : -6;
    qualityScore += side === "Long" ? (candidate.cvdSlope > 0 ? 6 : -6) : candidate.cvdSlope < 0 ? 6 : -6;
    qualityScore += side === "Long" ? (candidate.takerRatio > 1 ? 4 : -4) : candidate.takerRatio < 1 ? 4 : -4;

    const signal = buildStrategySignal({
      strategyId: "obfvg",
      side,
      tone,
      qualityScore,
      detectedAt: candles[retestIndex].time * 1000,
      entry: equilibrium,
      stopLoss,
      takeProfit,
      leverage: 5,
      note: "Displacement + fair value gap retest into the order-block equilibrium.",
      reason: `${side === "Long" ? "Bullish" : "Bearish"} displacement with fresh FVG retest • RR ${rr.toFixed(2)}`,
    });

    if (!bestSignal || signal.qualityScore > bestSignal.qualityScore) bestSignal = signal;
  }

  return bestSignal;
}

function buildFundingMeanReversionSignal(candidate) {
  const upper = latestDefinedValue(candidate.bollingerSeries?.upper || []);
  const lower = latestDefinedValue(candidate.bollingerSeries?.lower || []);
  const middle = latestDefinedValue(candidate.bollingerSeries?.middle || []);
  if (!Number.isFinite(upper) || !Number.isFinite(lower) || !Number.isFinite(middle)) return null;

  const currentCandle = candidate.candles?.[candidate.candles.length - 1];
  if (!currentCandle) return null;

  const longValid =
    candidate.fundingRate <= -0.03 &&
    candidate.currentPrice <= lower * 1.003 &&
    candidate.rsi <= 40 &&
    (currentCandle.close > currentCandle.open || lowerWickRatio(currentCandle) > 0.38);
  const shortValid =
    candidate.fundingRate >= 0.05 &&
    candidate.currentPrice >= upper * 0.997 &&
    candidate.rsi >= 60 &&
    (currentCandle.close < currentCandle.open || upperWickRatio(currentCandle) > 0.38);

  if (!longValid && !shortValid) return null;

  const side = longValid ? "Long" : "Short";
  const tone = longValid ? "up" : "down";
  const entry = candidate.currentPrice;
  const stopLoss =
    side === "Long"
      ? entry - candidate.latestAtr * 1.5
      : entry + candidate.latestAtr * 1.5;
  const takeProfit = middle;
  const projectedMovePct = Math.abs(pctChange(entry, takeProfit));
  if (projectedMovePct < 0.8) return null;

  let qualityScore = 62;
  qualityScore += Math.min(18, Math.round(Math.abs(candidate.fundingRate) * 180));
  qualityScore += side === "Long" ? (candidate.rsi <= 34 ? 10 : 4) : candidate.rsi >= 66 ? 10 : 4;
  qualityScore += side === "Long" ? (candidate.cvdSlope >= 0 ? 6 : -6) : candidate.cvdSlope <= 0 ? 6 : -6;
  qualityScore += side === "Long" ? (candidate.takerRatio < 1 ? 4 : 0) : candidate.takerRatio > 1 ? 4 : 0;

  return buildStrategySignal({
    strategyId: "funding",
    side,
    tone,
    qualityScore,
    detectedAt: currentCandle.time * 1000,
    entry,
    stopLoss,
    takeProfit,
    leverage: 5,
    note: "Extreme funding plus Bollinger band extension points to a mean-reversion setup.",
    reason: `Funding ${formatPercent(candidate.fundingRate, 4)} • fade back to basis line`,
  });
}

function attachStrategySignals(candidate) {
  const strategySignals = {
    core: buildCoreTrendStrategySignal(candidate),
    liq: buildLiquidationMagnetStrategySignal(candidate),
    obfvg: buildObFvgStrategySignal(candidate),
    funding: buildFundingMeanReversionSignal(candidate),
  };
  const bestStrategyQuality = Math.max(
    candidate.refinedQualityScore ?? candidate.qualityScore,
    ...Object.values(strategySignals)
      .filter(Boolean)
      .map((signal) => signal.qualityScore)
  );
  return {
    ...candidate,
    strategySignals,
    bestStrategyQuality,
  };
}

function selectUniverseBatch(universe) {
  const ranked = [...universe].sort((left, right) => {
    const rightTicker = universeTickerMap.get(right.symbol);
    const leftTicker = universeTickerMap.get(left.symbol);
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

  if (rotationPool.length) {
    const start = scanCursor % rotationPool.length;
    for (let index = 0; index < Math.min(ROTATION_SCAN_COUNT, rotationPool.length); index += 1) {
      rotationBatch.push(rotationPool[(start + index) % rotationPool.length]);
    }
    scanCursor = (start + ROTATION_SCAN_COUNT) % rotationPool.length;
  }

  const combined = [...priority, ...rotationBatch];
  state.openTrades.forEach((trade) => {
    const openTradeInfo = universe.find((item) => item.symbol === trade.symbol);
    if (openTradeInfo) combined.unshift(openTradeInfo);
  });

  return Array.from(new Map(combined.map((item) => [item.symbol, item])).values());
}

function formatParameterLine(candidate, ticker) {
  if (!candidate) {
    const volumeNote = ticker?.quoteVolume
      ? `24H vol ${new Intl.NumberFormat("en-US", {
          notation: "compact",
          maximumFractionDigits: 2,
        }).format(ticker.quoteVolume)}`
      : "Awaiting deep scan";
    return `${volumeNote} • queueing trend, flow, leverage, and entry plan`;
  }

  const strategyTags =
    STRATEGY_SPECS.length > 1
      ? STRATEGY_SPECS.filter((spec) => candidate.strategySignals?.[spec.id])
          .map((spec) => spec.shortLabel)
          .join(" • ")
      : "";

  return `
    <div class="monitor-parameter-stack">
      <div>Entry ${formatPrice(candidate.trade.entry, candidate.pricePrecision)} • TP ${formatPrice(
        candidate.trade.takeProfit,
        candidate.pricePrecision
      )} • SL ${formatPrice(candidate.trade.stopLoss, candidate.pricePrecision)}</div>
      <div class="monitor-subtle">
        ${candidate.ema20 >= candidate.ema50 ? "EMA bull" : "EMA bear"} • RSI ${candidate.rsi.toFixed(0)} •
        CVD ${formatPercent(candidate.cvdSlope)} • OI ${formatPercent(candidate.oiChange1h)} •
        RR ${candidate.rr.toFixed(2)} • target ${candidate.trade.targetReturnPct}% on margin •
        move ${formatPercent(candidate.trade.projectedMovePct)}
      </div>
      <div class="monitor-subtle">
        1H ${candidate.confirmation?.["1h"]?.label || "Queue"} • 4H ${
          candidate.confirmation?.["4h"]?.label || "Queue"
        } • entry score ${candidate.entryQualityScore ?? "--"}${
          strategyTags ? ` • signals ${strategyTags}` : ""
        }
      </div>
    </div>
  `;
}

function buildMarketRows(universe) {
  return universe
    .map((symbolInfo) => {
      const ticker = universeTickerMap.get(symbolInfo.symbol) || null;
      const analysis = analysisCache.get(symbolInfo.symbol) || null;
      const qualityScore = analysis?.refinedQualityScore ?? analysis?.qualityScore ?? -1;
      return {
        symbol: symbolInfo.symbol,
        baseAsset: symbolInfo.baseAsset,
        price: analysis?.currentPrice ?? ticker?.lastPrice ?? 0,
        changePct: ticker?.changePct ?? 0,
        biasLabel: analysis?.bias.label ?? "Monitoring",
        biasTone: analysis?.bias.tone ?? "neutral",
        strategySignals: analysis?.strategySignals || {},
        parameters: formatParameterLine(analysis, ticker),
        qualityScore,
        updatedAt: analysis?.analyzedAt ?? 0,
        volumeRank: ticker?.quoteVolume ?? 0,
      };
    })
    .sort((left, right) => {
      const rightQuality = right.qualityScore >= 0 ? right.qualityScore : -999;
      const leftQuality = left.qualityScore >= 0 ? left.qualityScore : -999;
      if (rightQuality !== leftQuality) return rightQuality - leftQuality;
      return right.volumeRank - left.volumeRank;
    });
}

function renderStrategySignalCell(signal) {
  if (!signal) return `<span class="monitor-subtle">-</span>`;
  const quality = signal.qualityScore;
  const toneClass =
    quality >= 100
      ? "quality-tier-gold"
      : quality >= 80
        ? "quality-tier-green"
        : quality >= 60
          ? "quality-tier-light-orange"
          : "quality-tier-red";
  return `
    <div class="strategy-cell-stack">
      <span class="quality-chip ${toneClass}">${signal.side === "Long" ? "L" : "S"} • Q${quality}</span>
      <div class="monitor-subtle">${new Date(signal.detectedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
    </div>
  `;
}

function renderMarketTable(universe) {
  if (!dom.marketTable) return;
  const rows = buildMarketRows(universe);
  const singleHouseStrategy = STRATEGY_SPECS.length === 1;

  if (!rows.length) {
    dom.marketTable.innerHTML = `
      <div class="monitor-empty">
        Loading Binance perpetual universe...
      </div>
    `;
    return;
  }

  const body = rows
    .map((row) => {
      const price = Number.isFinite(row.price) && row.price > 0 ? formatPrice(row.price, row.price >= 1 ? 4 : 6) : "-";
      const updatedLabel = row.updatedAt
        ? new Date(row.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "Queue";
      const qualityLabel = row.qualityScore >= 0 ? `Q${row.qualityScore}` : "--";
      const qualityQualified = row.qualityScore >= state.qualityThreshold + 10;
      return `
        <tr>
          <td>
            <div class="monitor-symbol">${row.symbol}</div>
            <div class="monitor-subtle">${updatedLabel}</div>
          </td>
          <td>${price}</td>
          <td class="${toneFromNumber(row.changePct, 0.15)}">${formatPercent(row.changePct)}</td>
          <td class="${row.biasTone}">${row.biasLabel}</td>
          ${
            singleHouseStrategy
              ? ""
              : `
          <td class="strategy-column">${renderStrategySignalCell(row.strategySignals.core)}</td>
          <td class="strategy-column">${renderStrategySignalCell(row.strategySignals.liq)}</td>
          <td class="strategy-column">${renderStrategySignalCell(row.strategySignals.obfvg)}</td>
          <td class="strategy-column">${renderStrategySignalCell(row.strategySignals.funding)}</td>
          `
          }
          <td>${row.parameters}</td>
          <td class="monitor-quality ${qualityQualified ? "qualified" : ""}">${qualityLabel}</td>
        </tr>
      `;
    })
    .join("");

  dom.marketTable.innerHTML = `
    <div class="monitor-table-shell">
      <table>
        <thead>
          <tr>
            <th>Pair</th>
            <th>Price</th>
            <th>24H</th>
            <th>Bias</th>
            ${
              singleHouseStrategy
                ? ""
                : `
            <th>Core</th>
            <th>Liq</th>
            <th>OB/FVG</th>
            <th>Funding</th>
            `
            }
            <th>Parameters</th>
            <th>Quality</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function logActivity(message, tone = "neutral") {
  state.activity.unshift({
    time: Date.now(),
    message,
    tone,
  });
  state.activity = state.activity.slice(0, 24);
}

function applyStrategyUpgradeNotice() {
  if (state.strategyVersion >= STRATEGY_VERSION) return;
  state.strategyBalances = buildDefaultStrategyBalances();
  state.balance = START_BALANCE;
  state.openTrades = [];
  state.closedTrades = [];
  state.activity = [];
  state.lastCandidates = [];
  state.lastScanAt = 0;
  analysisCache = new Map();
  universeTickerMap = new Map();
  scanCursor = 0;
  logActivity(
    "Auto Trade is back on the stricter house engine. The old in-flight book was cleared so the journal restarts on the restored high-quality model.",
    "neutral"
  );
  state.strategyVersion = STRATEGY_VERSION;
  persistState();
}

function reservedMargin(strategyId = null) {
  return state.openTrades
    .filter((trade) => !strategyId || trade.strategyId === strategyId)
    .reduce((sum, trade) => sum + (Number(trade.marginUsed) || 0), 0);
}

function strategyOpenTrades(strategyId) {
  return state.openTrades.filter((trade) => trade.strategyId === strategyId);
}

function strategyHasOpenTrade(strategyId, symbol = null) {
  return state.openTrades.some(
    (trade) => trade.strategyId === strategyId && (!symbol || trade.symbol === symbol)
  );
}

function recentlyClosed(symbol, strategyId = "core") {
  return state.closedTrades.some(
    (trade) =>
      trade.symbol === symbol &&
      trade.strategyId === strategyId &&
      Date.now() - Number(trade.closedAt || 0) < TRADE_COOLDOWN_MS
  );
}

function tradeReturnPct(trade, exitPrice) {
  const direction = trade.side === "Short" ? -1 : 1;
  return pctChange(trade.entryPrice, exitPrice) * direction * (trade.leverage || DEFAULT_LEVERAGE);
}

function openTradeFromCandidate(candidate) {
  const strategyId = "core";
  const spec = strategySpec(strategyId);
  if (strategyHasOpenTrade(strategyId, candidate.symbol)) return false;
  if (strategyOpenTrades(strategyId).length >= spec.maxOpenTrades) return false;
  if (state.openTrades.length >= MAX_CONCURRENT_TRADES) return false;

  const strategyBalanceBefore = Number(state.strategyBalances?.[strategyId]) || STRATEGY_START_BALANCE;
  const freeCapital = Math.max(strategyBalanceBefore - reservedMargin(strategyId), 0);
  if (freeCapital < 10) return false;

  const leverage = candidate.trade.leverage || DEFAULT_LEVERAGE;
  const slotsRemaining = Math.max(1, (spec.maxOpenTrades || 1) - strategyOpenTrades(strategyId).length);
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

  state.openTrades.push({
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
    pricePrecision: candidate.pricePrecision,
    breakEvenArmed: false,
    profitLockArmed: false,
    openedAt: Date.now(),
    detectedAt: Date.now(),
    balanceBefore: state.balance,
    strategyBalanceBefore,
    lastPrice: candidate.currentPrice,
  });

  logActivity(
    `Opened ${spec.label} ${candidate.trade.stance} ${candidate.symbol} • entry ${formatPrice(
      candidate.trade.entry,
      candidate.pricePrecision
    )} • TP ${formatPrice(candidate.trade.takeProfit, candidate.pricePrecision)} • SL ${formatPrice(
      candidate.trade.stopLoss,
      candidate.pricePrecision
    )} • quality ${(candidate.refinedQualityScore ?? candidate.qualityScore).toFixed(0)} • target ${candidate.trade.targetReturnPct.toFixed(
      1
    )}% on margin (${formatPercent(
      candidate.trade.projectedMovePct
    )} price move).`,
    candidate.trade.tone
  );

  return true;
}

function closeTrade(tradeId, reason, exitPrice, precisionHint) {
  const tradeIndex = state.openTrades.findIndex((trade) => trade.id === tradeId);
  if (tradeIndex === -1) return;

  const trade = state.openTrades[tradeIndex];
  const direction = trade.side === "Short" ? -1 : 1;
  const pnlUsd = (exitPrice - trade.entryPrice) * trade.quantity * direction;
  const pnlPct = pctChange(trade.entryPrice, exitPrice) * direction;
  const returnPct = tradeReturnPct(trade, exitPrice);
  const balanceAfter = state.balance + pnlUsd;

  state.closedTrades.unshift({
    id: trade.id,
    strategyId: trade.strategyId,
    strategyLabel: trade.strategyLabel,
    symbol: trade.symbol,
    side: trade.side,
    entryPrice: trade.entryPrice,
    exitPrice,
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit,
    detectedAt: trade.detectedAt,
    openedAt: trade.openedAt,
    closedAt: Date.now(),
    reason,
    pnlUsd,
    pnlPct,
    returnPct,
    balanceBefore: trade.balanceBefore,
    balanceAfter,
    strategyBalanceBefore: trade.strategyBalanceBefore,
    strategyBalanceAfter: trade.strategyBalanceBefore + pnlUsd,
    quantity: trade.quantity,
    pricePrecision: trade.pricePrecision,
  });
  state.closedTrades = state.closedTrades.slice(0, 90);
  state.strategyBalances[trade.strategyId] =
    (Number(state.strategyBalances[trade.strategyId]) || STRATEGY_START_BALANCE) + pnlUsd;
  recomputeTotalBalance();
  state.openTrades.splice(tradeIndex, 1);

  logActivity(
    `${reason} closed ${trade.strategyLabel} ${trade.side} ${trade.symbol} • entry ${formatPrice(
      trade.entryPrice,
      precisionHint
    )} • exit ${formatPrice(exitPrice, precisionHint)} • ${formatPercent(
      returnPct
    )} on margin • ${formatCompactUsd(pnlUsd, 2)}.`,
    reason === "TP" ? "up" : "down"
  );
}

function tightenTradeProtection(trade, candidate) {
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
      `Protected ${trade.symbol} by moving the stop to breakeven after early follow-through.`,
      "neutral"
    );
  }

  if (progress >= 0.75 && !trade.profitLockArmed) {
    trade.stopLoss = lockedStop;
    trade.profitLockArmed = true;
    logActivity(
      `Locked profit on ${trade.symbol}; stop advanced to ${formatPrice(
        trade.stopLoss,
        candidate.pricePrecision
      )}.`,
      direction === 1 ? "up" : "down"
    );
  }
}

function refreshOpenTrades(candidates) {
  if (!state.openTrades.length) return;
  const candidateMap = new Map(candidates.map((candidate) => [candidate.symbol, candidate]));
  const trades = [...state.openTrades];

  trades.forEach((trade) => {
    const candidate = candidateMap.get(trade.symbol);
    if (!candidate) return;

    trade.lastPrice = candidate.currentPrice;
    trade.pricePrecision = candidate.pricePrecision;
    tightenTradeProtection(trade, candidate);
    const hitTarget =
      trade.side === "Long"
        ? candidate.currentPrice >= trade.takeProfit
        : candidate.currentPrice <= trade.takeProfit;
    const hitStop =
      trade.side === "Long"
        ? candidate.currentPrice <= trade.stopLoss
        : candidate.currentPrice >= trade.stopLoss;

    if (hitTarget) closeTrade(trade.id, "TP", trade.takeProfit, candidate.pricePrecision);
    else if (hitStop) closeTrade(trade.id, "SL", trade.stopLoss, candidate.pricePrecision);
  });
}

function openQualifiedTrades(candidates) {
  const opened = [];
  const spec = STRATEGY_SPECS[0];
  const eligible = highQualityCandidates(candidates, state.qualityThreshold).filter(
    (entry) => !strategyHasOpenTrade(spec.id, entry.symbol) && !recentlyClosed(entry.symbol, spec.id)
  );

  for (const candidate of eligible) {
    if (opened.length >= MAX_NEW_TRADES_PER_SCAN) break;
    if (strategyOpenTrades(spec.id).length >= spec.maxOpenTrades) break;
    if (openTradeFromCandidate(candidate)) {
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

function summarizeEngine(candidates, threshold) {
  const qualified = highQualityCandidates(candidates, threshold);
  if (!qualified.length) {
    if (state.openTrades.length) {
      return `${state.openTrades.length}/${MAX_CONCURRENT_TRADES} paper positions are active. No fresh setup currently clears quality ${threshold}, so the engine is focused on managing existing TP and SL levels.`;
    }
    return `No perp currently meets the quality threshold of ${threshold}. The engine is continuously checking the full Binance USDT perp universe for stronger alignment across trend, order flow, leverage, and risk/reward.`;
  }

  const best = qualified[0];
  if (state.openTrades.length) {
    return `${state.openTrades.length}/${MAX_CONCURRENT_TRADES} paper positions are active. ${qualified.length} fresh house setups still meet the stricter filter, and ${best.symbol} leads with entry ${formatPrice(
      best.trade.entry,
      best.pricePrecision
    )}, TP ${formatPrice(best.trade.takeProfit, best.pricePrecision)}, and SL ${formatPrice(
      best.trade.stopLoss,
      best.pricePrecision
    )}.`;
  }

  return `${qualified.length} high-quality house setups are live across the perp universe. ${best.symbol} leads with entry ${formatPrice(
    best.trade.entry,
    best.pricePrecision
  )}, TP ${formatPrice(best.trade.takeProfit, best.pricePrecision)}, SL ${formatPrice(
    best.trade.stopLoss,
    best.pricePrecision
  )}, quality ${best.refinedQualityScore ?? best.qualityScore}, and ${
    best.trade.targetReturnPct.toFixed(1)
  }% target return on margin (${formatPercent(
    best.trade.projectedMovePct
  )} price move).`;
}

function renderStrategySleeves(candidates) {
  if (!dom.strategySleeveGrid) return;

  const spec = STRATEGY_SPECS[0];
  const realizedBalance = Number(state.strategyBalances?.[spec.id]) || STRATEGY_START_BALANCE;
  const openTrades = strategyOpenTrades(spec.id);
  const unrealizedUsd = openTrades.reduce((sum, trade) => {
    const direction = trade.side === "Short" ? -1 : 1;
    if (!Number.isFinite(trade.lastPrice)) return sum;
    return sum + (trade.lastPrice - trade.entryPrice) * trade.quantity * direction;
  }, 0);
  const equity = realizedBalance + unrealizedUsd;
  const closed = state.closedTrades.filter((trade) => trade.strategyId === spec.id);
  const wins = closed.filter((trade) => trade.reason === "TP").length;
  const winRate = closed.length ? (wins / closed.length) * 100 : 0;
  const lead = highQualityCandidates(candidates, state.qualityThreshold)[0] || null;
  const cards = [
    {
      label: spec.label,
      value: `${formatPrice(equity, 2)} • ${openTrades.length} open`,
      note: lead
        ? `${lead.symbol} ${lead.trade.stance} • Q${lead.refinedQualityScore ?? lead.qualityScore} • ${formatPercent(
            lead.trade.projectedMovePct
          )} move • ${wins}/${closed.length} wins (${winRate.toFixed(0)}%)`
        : `${wins}/${closed.length} wins (${winRate.toFixed(0)}%) • no live house setup above the active bar`,
      tone:
        equity > STRATEGY_START_BALANCE + 0.5
          ? "up"
          : equity < STRATEGY_START_BALANCE - 0.5
            ? "down"
            : spec.tone,
    },
  ];

  renderAnalysisGrid(dom.strategySleeveGrid, cards);
}

function renderDashboard(universe = []) {
  const realizedPnl = state.balance - state.startingBalance;
  const winCount = state.closedTrades.filter((trade) => trade.reason === "TP").length;
  const totalClosed = state.closedTrades.length;
  const winRate = totalClosed ? (winCount / totalClosed) * 100 : 0;
  const openTrades = state.openTrades;
  const unrealizedUsd = openTrades.reduce((sum, trade) => {
    const direction = trade.side === "Short" ? -1 : 1;
    if (!Number.isFinite(trade.lastPrice)) return sum;
    return sum + (trade.lastPrice - trade.entryPrice) * trade.quantity * direction;
  }, 0);
  const currentEquity = state.balance + unrealizedUsd;
  const leadOpenTrade = openTrades[0] || null;

  dom.metricStartBalance.textContent = formatPrice(state.startingBalance, 2);
  dom.metricCurrentEquity.textContent = formatPrice(currentEquity, 2);
  dom.metricCurrentEquity.className = toneFromNumber(currentEquity - state.startingBalance, 0.01);
  dom.metricCurrentNote.textContent = openTrades.length
    ? `${openTrades.length} open positions • unrealized ${formatCompactUsd(unrealizedUsd, 2)}`
    : "No open position";
  dom.metricRealizedPnl.textContent = formatCompactUsd(realizedPnl, 2);
  dom.metricRealizedPnl.className = toneFromNumber(realizedPnl, 0.01);
  dom.metricRealizedNote.textContent = `${formatPercent(pctChange(state.startingBalance, state.balance))} vs start`;
  dom.metricWinRate.textContent = `${winRate.toFixed(0)}%`;
  dom.metricWinRate.className = toneFromNumber(winRate - 50, 2);
  dom.metricWinRateNote.textContent = `${winCount} winners / ${totalClosed} closed trades`;
  dom.metricOpenTrade.textContent = openTrades.length
    ? `${openTrades.length} Active`
    : "None";
  dom.metricOpenTrade.className = openTrades.length
    ? toneFromNumber(unrealizedUsd, 0.01)
    : "neutral";
  dom.metricOpenNote.textContent = leadOpenTrade
    ? `${leadOpenTrade.symbol} ${leadOpenTrade.side} • entry ${formatPrice(
        leadOpenTrade.entryPrice,
        leadOpenTrade.pricePrecision || 2
      )} • TP ${formatPrice(leadOpenTrade.takeProfit, leadOpenTrade.pricePrecision || 2)} • SL ${formatPrice(
        leadOpenTrade.stopLoss,
        leadOpenTrade.pricePrecision || 2
      )}`
    : "Waiting for a high-quality setup";
  dom.metricLastScan.textContent = state.lastScanAt
    ? new Date(state.lastScanAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "-";
  dom.metricLastScanNote.textContent = state.autoEnabled
    ? "Auto engine armed across full perp universe"
    : "Auto engine paused";

  if (dom.engineSummary) {
    dom.engineSummary.textContent = summarizeEngine(state.lastCandidates, state.qualityThreshold);
  }
  if (dom.universeInput) dom.universeInput.value = "All Binance USDT Perps";
  if (dom.universeCount) dom.universeCount.value = universe.length ? `${universe.length} contracts` : "Loading...";
  renderStrategySleeves(state.lastCandidates);

  renderMarketTable(universe);

  renderAnalysisGrid(
    dom.openPositionGrid,
    openTrades.length
      ? openTrades.slice(0, 6).map((trade) => ({
          label: `${trade.strategyLabel} • ${trade.symbol} ${trade.side}`,
          value: `${formatPercent(
            tradeReturnPct(trade, trade.lastPrice || trade.entryPrice)
          )} live`,
          note: `Entry ${formatPrice(trade.entryPrice, trade.pricePrecision || 2)} • TP ${formatPrice(
            trade.takeProfit,
            trade.pricePrecision || 2
          )} • SL ${formatPrice(trade.stopLoss, trade.pricePrecision || 2)} • margin ${formatPrice(
            trade.marginUsed,
            2
          )} • ${trade.leverage}x`,
          tone: trade.side === "Long" ? "up" : "down",
        }))
      : [
          {
            label: "Engine waiting",
            value: "No open trade",
            note: "The simulator will open the next high-quality setup automatically.",
            tone: "neutral",
          },
        ]
  );

  renderTable(
    dom.tradeLogTable,
    state.closedTrades.slice(0, 12).map((trade) => ({
      label: `${trade.strategyLabel} • ${trade.symbol} ${trade.side} • ${trade.reason}`,
      primary: `Entry ${formatPrice(trade.entryPrice, trade.pricePrecision || 2)} • Exit ${formatPrice(
        trade.exitPrice,
        trade.pricePrecision || 2
      )}`,
      secondaryLabel: "Plan",
      secondary: `TP ${formatPrice(trade.takeProfit, trade.pricePrecision || 2)} • SL ${formatPrice(
        trade.stopLoss,
        trade.pricePrecision || 2
      )} • ${new Date(trade.detectedAt || trade.openedAt).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}`,
      tertiaryLabel: "Result",
      tertiary: `${formatPercent(trade.returnPct || 0)} on margin • ${formatCompactUsd(
        trade.pnlUsd,
        2
      )} • Bal ${formatPrice(trade.strategyBalanceAfter || trade.balanceAfter, 2)}`,
      tone: trade.reason === "TP" ? "up" : "down",
    })),
    "No closed trades yet"
  );

  renderTable(
    dom.activityTable,
    state.activity.slice(0, 12).map((item) => ({
      label: new Date(item.time).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      primary: item.message,
      secondaryLabel: "Mode",
      secondary: state.autoEnabled ? "Auto" : "Manual",
      tertiaryLabel: "Status",
      tertiary: item.tone === "up" ? "Constructive" : item.tone === "down" ? "Defensive" : "Watching",
      tone: item.tone,
    })),
    "No engine activity yet"
  );

  dom.autoToggleButton.textContent = state.autoEnabled ? "Pause Auto" : "Resume Auto";
  dom.autoRunNote.textContent = state.autoEnabled
    ? `Auto-scans every 90 seconds, can open up to ${MAX_NEW_TRADES_PER_SCAN} fresh trades per pass, and can hold up to ${MAX_CONCURRENT_TRADES} quality positions.`
    : "Auto engine paused. Manual scans still work.";
  renderPaperTabs();
}

async function scanUniverse({ manual = false } = {}) {
  if (scanning) return;
  scanning = true;

  try {
    const universe = await getPerpUniverse();
    const tickers = await fetchUniverseTickers();
    universeTickerMap = buildTickerLookup(tickers);
    const batch = selectUniverseBatch(universe);

    setStatus(
      `Monitoring ${universe.length} perps. Deep-scanning ${batch.length} contracts for quality setups...`,
      "neutral"
    );

    const results = await mapWithConcurrency(batch, ANALYSIS_CONCURRENCY, async (symbolInfo) => {
      try {
        return analyzeSnapshot(await fetchEngineSnapshot(symbolInfo.symbol, state.interval));
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
          confirmationMap.get(candidate.symbol) || {}
        )
      )
      .map((candidate) => attachStrategySignals(candidate))
      .sort(
        (left, right) =>
          (right.bestStrategyQuality ?? right.refinedQualityScore ?? right.qualityScore) -
          (left.bestStrategyQuality ?? left.refinedQualityScore ?? left.qualityScore)
      );

    candidates.forEach((candidate) => {
      analysisCache.set(candidate.symbol, {
        ...candidate,
        analyzedAt: Date.now(),
      });
    });

    state.lastCandidates = Array.from(analysisCache.values())
      .sort(
        (left, right) =>
          (right.bestStrategyQuality ?? right.refinedQualityScore ?? right.qualityScore) -
          (left.bestStrategyQuality ?? left.refinedQualityScore ?? left.qualityScore)
      )
      .slice(0, 48);
    state.lastScanAt = Date.now();

    refreshOpenTrades(candidates);

    const qualified = highQualityCandidates(candidates, state.qualityThreshold);
    const opened = openQualifiedTrades(candidates);

    if (opened.length) {
      const lead = opened[0];
      setStatus(
        `Opened ${opened.length} new house-strategy trade${opened.length > 1 ? "s" : ""}. ${state.openTrades.length}/${MAX_CONCURRENT_TRADES} positions active, led by ${lead.symbol}.`,
        lead.trade?.tone || lead.bias?.tone || "up"
      );
    } else if (state.openTrades.length) {
      setStatus(
        `Monitoring ${state.openTrades.length} active paper position${state.openTrades.length > 1 ? "s" : ""} while the universe scan continues.`,
        state.openTrades.some((trade) => trade.side === "Long") ? "up" : "down"
      );
    } else if (qualified.length) {
      setStatus(
        `${qualified.length} setups qualify, but margin or cooldown rules are holding entries for now.`,
        qualified[0].bias.tone
      );
    } else {
      if (manual) {
        logActivity(
          `Manual universe scan found no setup above quality ${state.qualityThreshold}.`,
          "neutral"
        );
      }
      setStatus(`No trade opened. Waiting for quality >= ${state.qualityThreshold}.`, "neutral");
    }

    persistState();
    renderDashboard(universe);
  } catch (error) {
    const message = friendlyErrorMessage(error);
    setStatus(message, "down");
    logActivity(message, "down");
    persistState();
    renderDashboard(perpUniverseCache || []);
  } finally {
    scanning = false;
  }
}

function scheduleAutoScan() {
  if (autoTimer) window.clearInterval(autoTimer);
  autoTimer = null;
  if (!state.autoEnabled) return;
  autoTimer = window.setInterval(() => {
    scanUniverse();
  }, AUTO_SCAN_MS);
}

function syncControls() {
  if (dom.universeInput) dom.universeInput.value = "All Binance USDT Perps";
  if (dom.universeCount) dom.universeCount.value = perpUniverseCache ? `${perpUniverseCache.length} contracts` : "Loading...";
  dom.scanInterval.value = state.interval;
  dom.qualityThreshold.value = `${state.qualityThreshold}`;
}

dom.autoForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.interval = dom.scanInterval.value || DEFAULT_INTERVAL;
  state.qualityThreshold = Math.max(50, Number(dom.qualityThreshold.value) || DEFAULT_QUALITY_THRESHOLD);
  persistState();
  scanUniverse({ manual: true });
});

dom.autoToggleButton.addEventListener("click", () => {
  state.autoEnabled = !state.autoEnabled;
  persistState();
  scheduleAutoScan();
  renderDashboard();
  setStatus(state.autoEnabled ? "Auto paper trader resumed." : "Auto paper trader paused.", state.autoEnabled ? "up" : "neutral");
});

dom.resetSimButton.addEventListener("click", () => {
  state.strategyBalances = buildDefaultStrategyBalances();
  state.balance = START_BALANCE;
  state.openTrades = [];
  state.closedTrades = [];
  state.activity = [];
  state.lastCandidates = [];
  state.lastScanAt = 0;
  analysisCache = new Map();
  universeTickerMap = new Map();
  scanCursor = 0;
  logActivity("Simulation reset to the $200 house strategy book.", "neutral");
  persistState();
  renderDashboard(perpUniverseCache || []);
  setStatus("Simulation reset to the $200 house strategy book.", "neutral");
});

if (dom.paperTabPositions) {
  dom.paperTabPositions.addEventListener("click", () => {
    state.activeTab = "positions";
    persistState();
    renderPaperTabs();
  });
}

if (dom.paperTabTrades) {
  dom.paperTabTrades.addEventListener("click", () => {
    state.activeTab = "trades";
    persistState();
    renderPaperTabs();
  });
}

if (dom.paperTabActivity) {
  dom.paperTabActivity.addEventListener("click", () => {
    state.activeTab = "activity";
    persistState();
    renderPaperTabs();
  });
}

syncControls();
applyStrategyUpgradeNotice();
renderDashboard();
scheduleAutoScan();
scanUniverse();
