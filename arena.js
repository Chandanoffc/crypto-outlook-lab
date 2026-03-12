const DEFAULT_QUALITY_THRESHOLD = 68;
const BASE_INTERVAL = "15m";
const QUOTE_ASSET = "USDT";
const AUTO_SCAN_MS = 5 * 60 * 1000;
const PRIORITY_SCAN_COUNT = 10;
const ROTATION_SCAN_COUNT = 24;
const ANALYSIS_CONCURRENCY = 5;
const TIMEFRAME_CONCURRENCY = 4;
const TIMEFRAME_CACHE_MS = 4.5 * 60 * 1000;
const STORAGE_KEY = "apex-signals-arena-state";
const TICKER_STORAGE_KEY = "apex-signals-arena-tickers";
const TICKER_CACHE_MAX_AGE_MS = 30 * 60 * 1000;
const TIMEFRAME_CONFIG = [
  { key: "30m", label: "30m", interval: "30m" },
  { key: "1h", label: "1H", interval: "1h" },
  { key: "4h", label: "4H", interval: "4h" },
  { key: "1d", label: "1D", interval: "1d" },
];

const dom = {
  arenaForm: document.getElementById("arena-form"),
  universeInput: document.getElementById("arena-universe"),
  cycleInput: document.getElementById("arena-cycle"),
  qualityThreshold: document.getElementById("arena-quality-threshold"),
  refreshSubmit: document.getElementById("arena-refresh-submit"),
  statusBanner: document.getElementById("arena-status-banner"),
  metricUniverse: document.getElementById("arena-metric-universe"),
  metricUniverseNote: document.getElementById("arena-metric-universe-note"),
  metricHighVolume: document.getElementById("arena-metric-high-volume"),
  metricHighVolumeNote: document.getElementById("arena-metric-high-volume-note"),
  metricMidVolume: document.getElementById("arena-metric-mid-volume"),
  metricMidVolumeNote: document.getElementById("arena-metric-mid-volume-note"),
  metricLowVolume: document.getElementById("arena-metric-low-volume"),
  metricLowVolumeNote: document.getElementById("arena-metric-low-volume-note"),
  metricQualified: document.getElementById("arena-metric-qualified"),
  metricQualifiedNote: document.getElementById("arena-metric-qualified-note"),
  metricLastScan: document.getElementById("arena-metric-last-scan"),
  metricLastScanNote: document.getElementById("arena-metric-last-scan-note"),
  shortTermGrid: document.getElementById("arena-short-term-grid"),
  longTermGrid: document.getElementById("arena-long-term-grid"),
  engineSummary: document.getElementById("arena-engine-summary"),
  candidateGrid: document.getElementById("arena-candidate-grid"),
  tabSelection: document.getElementById("arena-tab-selection"),
  tabQuality: document.getElementById("arena-tab-quality"),
  tabTrending: document.getElementById("arena-tab-trending"),
  tabNote: document.getElementById("arena-tab-note"),
  selectionPanel: document.getElementById("arena-selection-panel"),
  qualityPanel: document.getElementById("arena-quality-panel"),
  trendingPanel: document.getElementById("arena-trending-panel"),
  qualityFramework: document.getElementById("arena-quality-framework"),
  qualityTable: document.getElementById("arena-quality-table"),
  trendingTable: document.getElementById("arena-trending-table"),
  refreshButton: document.getElementById("arena-refresh-button"),
  refreshNote: document.getElementById("arena-refresh-note"),
};

const state = loadState();
let exchangeInfoCache = null;
let perpUniverseCache = null;
let universeTickerMap = new Map();
let analysisCache = new Map();
let timeframeCache = new Map();
let scanCursor = 0;
let scanTimer = null;
let scanning = false;
let tickerFeedState = {
  source: "pending",
  degraded: false,
  warning: "",
};

function loadState() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      qualityThreshold: Number(stored.qualityThreshold) || DEFAULT_QUALITY_THRESHOLD,
      activeTab: stored.activeTab || "selection",
      lastScanAt: Number(stored.lastScanAt) || 0,
      lastCandidates: Array.isArray(stored.lastCandidates) ? stored.lastCandidates : [],
    };
  } catch (error) {
    return {
      qualityThreshold: DEFAULT_QUALITY_THRESHOLD,
      activeTab: "selection",
      lastScanAt: 0,
      lastCandidates: [],
    };
  }
}

function persistState() {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      qualityThreshold: state.qualityThreshold,
      activeTab: state.activeTab,
      lastScanAt: state.lastScanAt,
      lastCandidates: state.lastCandidates,
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
    // Ignore storage failures in degraded environments.
  }
}

function setStatus(message, tone = "neutral") {
  dom.statusBanner.textContent = message;
  dom.statusBanner.className = `status-banner ${tone}`;
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
  score += context.rsi >= 52 && context.rsi <= 68 ? 8 : context.rsi < 44 ? -10 : -4;
  score += context.macdHistogram > 0 ? 10 : -10;
  score += context.cvdSlope > 0 ? 12 : -12;
  score += context.depthImbalance > 0.04 ? 8 : context.depthImbalance < -0.04 ? -8 : 0;
  score += context.oiChange1h > 0 ? 7 : -7;
  score += context.takerRatio > 1.02 ? 8 : context.takerRatio < 0.98 ? -8 : 0;
  score += context.fundingRate > 0 && context.fundingRate < 0.03 ? 4 : context.fundingRate < 0 ? -3 : -4;
  score += context.globalLongShortRatio > 1.04 ? 3 : context.globalLongShortRatio < 0.96 ? -3 : 0;
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
  const riskUnit = Math.max(context.latestAtr * 0.9, context.currentPrice * 0.006);
  const bandBuffer = Math.max(context.bandWidth || 0, riskUnit * 0.18);
  let stopLoss;
  let takeProfit;

  if (tone === "up") {
    const nearestSupport = supportLevels.find((level) => level < entry) ?? entry - riskUnit;
    const nearestResistance = resistanceLevels.find((level) => level > entry) ?? entry + riskUnit * 1.2;
    stopLoss = Math.min(nearestSupport - bandBuffer, entry - riskUnit * 0.9);
    takeProfit = Math.max(nearestResistance, entry + riskUnit);
  } else {
    const nearestResistance = resistanceLevels.find((level) => level > entry) ?? entry + riskUnit;
    const nearestSupport = supportLevels.find((level) => level < entry) ?? entry - riskUnit * 1.2;
    stopLoss = Math.max(nearestResistance + bandBuffer, entry + riskUnit * 0.9);
    takeProfit = Math.min(nearestSupport, entry - riskUnit);
  }

  const rr = Math.abs(takeProfit - entry) / Math.max(Math.abs(entry - stopLoss), 0.0000001);
  return {
    stance,
    tone,
    entry,
    stopLoss,
    takeProfit,
    rr,
  };
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
  const latestAtr = latestDefinedValue(atrSeries) ?? currentPrice * 0.01;
  const supportResistance = computeSupportResistance(candles, currentPrice, latestAtr);
  const tradeSummary = analyzeTradeTape(snapshot.trades || []);
  const depthSummary = analyzeOrderbook(snapshot.depth || { bids: [], asks: [] }, currentPrice);
  const takerSummary = analyzeTakerLongShort(snapshot.takerLongShort || []);
  const oiHistory = (snapshot.openInterestHistory || []).map((entry) => Number(entry.sumOpenInterest));
  const oiChange1h = pctChangeFromLookback(oiHistory, 12);
  const fundingRate = (Number(snapshot.premiumIndex?.lastFundingRate) || 0) * 100;
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
      (oiChange1h * (bias.tone === "up" ? 1 : -1) > 0 ? 6 : -6) +
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
    ema20: latestDefinedValue(ema20Series) ?? currentPrice,
    ema50: latestDefinedValue(ema50Series) ?? currentPrice,
    rsi: latestDefinedValue(rsiSeries) ?? 50,
    latestAtr,
    fundingRate,
    oiChange1h,
    cvdSlope: tradeSummary.cvdSlope,
    depthImbalance: depthSummary.imbalance,
    takerRatio: takerSummary.latestRatio,
    globalLongShortRatio,
    venueConsensus,
    trade: potentialTrade,
  };
}

function highQualityCandidates(candidates, threshold) {
  return candidates
    .filter(
      (candidate) =>
        candidate.bias.tone !== "neutral" &&
        candidate.qualityScore >= threshold &&
        candidate.rr >= 1.2
    )
    .sort((left, right) => right.qualityScore - left.qualityScore);
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

function qualityTier(score) {
  if (!Number.isFinite(score)) {
    return {
      className: "quality-tier-neutral",
      label: "Unscored",
    };
  }

  if (score >= 200) {
    return {
      className: "quality-tier-shining-gold",
      label: "Elite",
    };
  }

  if (score >= 100) {
    return {
      className: "quality-tier-gold",
      label: "Prime",
    };
  }

  if (score >= 80) {
    return {
      className: "quality-tier-green",
      label: "Strong",
    };
  }

  if (score >= 60) {
    return {
      className: "quality-tier-light-orange",
      label: "Watch",
    };
  }

  if (score >= 40) {
    return {
      className: "quality-tier-orange",
      label: "Weak",
    };
  }

  return {
    className: "quality-tier-red",
    label: "Poor",
  };
}

function formatClock(timestamp) {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
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
  exchangeInfoCache = await fetchJson("https://fapi.binance.com/fapi/v1/exchangeInfo", "Exchange info");
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
      lastPrice: Number(entry.lastPrice ?? entry.price ?? entry.markPrice),
      changePct: Number(entry.priceChangePercent) || 0,
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

async function fetchUniverseTickersDirect(activeSymbols) {
  const tickers = await fetchJson("https://fapi.binance.com/fapi/v1/ticker/24hr", "24H tickers");
  return mapUniverseTickers(tickers, activeSymbols);
}

async function fetchUniverseTickersServer(activeSymbols) {
  const response = await fetch(new URL("/api/arena-universe", window.location.origin));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Arena ticker proxy failed (${response.status})`);
  }
  tickerFeedState = {
    source: payload.source || "server proxy",
    degraded: Boolean(payload.degraded),
    warning: payload.warning || "",
  };
  return mapUniverseTickers(payload.tickers || [], activeSymbols);
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
    tickerFeedState = {
      source: "browser 24H feed",
      degraded: false,
      warning: "",
    };
    persistTickers(tickers);
    return tickers;
  } catch (directError) {
    try {
      const tickers = await fetchUniverseTickersServer(activeSymbols);
      if (tickers.length) persistTickers(tickers);
      return tickers;
    } catch (serverError) {
      if (cachedTickers?.length) {
        tickerFeedState = {
          source: "cached 24H feed",
          degraded: true,
          warning: serverError.message || directError.message,
        };
        return cachedTickers;
      }

      try {
        const tickers = await fetchUniversePricesFallback(activeSymbols);
        tickerFeedState = {
          source: "price-only fallback",
          degraded: true,
          warning: serverError.message || directError.message,
        };
        return tickers;
      } catch (priceError) {
        tickerFeedState = {
          source: "universe shell fallback",
          degraded: true,
          warning:
            priceError.message || serverError.message || directError.message || "Universe ticker feed unavailable",
        };
        return buildShellTickers(activeSymbols);
      }
    }
  }
}

async function fetchDirectSnapshot(token, interval) {
  const exchangeInfo = await getExchangeInfo();
  const resolved = resolvePerpSymbol(token, exchangeInfo);

  const requests = await Promise.allSettled([
    fetchJson(
      `https://fapi.binance.com/fapi/v1/klines?symbol=${resolved.symbol}&interval=${interval}&limit=240`,
      "Klines"
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
    tickerResult,
    depthResult,
    tradesResult,
    premiumResult,
    oiHistoryResult,
    globalResult,
    takerResult,
  ] = requests;

  if (klinesResult.status !== "fulfilled" || tickerResult.status !== "fulfilled") {
    throw new Error(`Core data unavailable for ${resolved.symbol}`);
  }

  return {
    token: resolved.cleanedToken,
    symbol: resolved.symbol,
    baseAsset: resolved.baseAsset,
    pricePrecision: resolved.pricePrecision,
    candles: klinesResult.value.map(mapKlineEntry),
    ticker: tickerResult.value,
    depth: depthResult.status === "fulfilled" ? depthResult.value : { bids: [], asks: [] },
    trades: tradesResult.status === "fulfilled" ? tradesResult.value : [],
    premiumIndex: premiumResult.status === "fulfilled" ? premiumResult.value : null,
    openInterestHistory: oiHistoryResult.status === "fulfilled" ? oiHistoryResult.value : [],
    globalLongShort: globalResult.status === "fulfilled" ? globalResult.value : [],
    takerLongShort: takerResult.status === "fulfilled" ? takerResult.value : [],
    venues: [],
  };
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

function selectUniverseBatch(universe) {
  const ranked = [...universe].sort((left, right) => {
    const rightTicker = universeTickerMap.get(right.symbol);
    const leftTicker = universeTickerMap.get(left.symbol);
    return (rightTicker?.quoteVolume || 0) - (leftTicker?.quoteVolume || 0);
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

  return Array.from(new Map([...priority, ...rotationBatch].map((item) => [item.symbol, item])).values());
}

function volumeTier(quoteVolume) {
  if (quoteVolume >= 750_000_000) return { label: "High Volume", tone: "up" };
  if (quoteVolume >= 100_000_000) return { label: "Mid Cap Volume", tone: "neutral" };
  return { label: "Low Cap Volume", tone: "down" };
}

function hasGoodTradingVolume(quoteVolume) {
  return quoteVolume >= 50_000_000;
}

function buildBullBearSignals(candidate, ticker, timeframeSummary) {
  const bullishSignals = [];
  const bearishSignals = [];
  const quoteVolume = ticker?.quoteVolume || 0;
  const tfEntries = Object.values(timeframeSummary || {});
  const bullishTf = tfEntries.filter((entry) => entry.tone === "up").length;
  const bearishTf = tfEntries.filter((entry) => entry.tone === "down").length;

  if (hasGoodTradingVolume(quoteVolume)) bullishSignals.push("Good trading volume");
  else bearishSignals.push("Thin trading volume");

  if (candidate.ema20 > candidate.ema50) bullishSignals.push("EMA stack bullish");
  else bearishSignals.push("EMA stack bearish");

  if (candidate.rsi >= 52 && candidate.rsi <= 68) bullishSignals.push("RSI supportive");
  else if (candidate.rsi < 45) bearishSignals.push("RSI weak");

  if (candidate.cvdSlope > 0) bullishSignals.push("CVD rising");
  else bearishSignals.push("CVD fading");

  if (candidate.takerRatio > 1.02) bullishSignals.push("Taker buyers active");
  else if (candidate.takerRatio < 0.98) bearishSignals.push("Taker sellers active");

  if (candidate.oiChange1h > 0 && candidate.bias.tone === "up") bullishSignals.push("OI supports move");
  if (candidate.oiChange1h > 0 && candidate.bias.tone === "down") bearishSignals.push("OI builds on weakness");

  if (bullishTf > bearishTf) bullishSignals.push(`${bullishTf}/4 timeframes aligned`);
  if (bearishTf > bullishTf) bearishSignals.push(`${bearishTf}/4 timeframes aligned`);

  return {
    bullishSignals: bullishSignals.slice(0, 4),
    bearishSignals: bearishSignals.slice(0, 4),
  };
}

function summarizeTimeframe(candles) {
  const closes = candles.map((candle) => candle.close);
  const current = closes[closes.length - 1] || 0;
  const ema20Series = ema(closes, 20);
  const ema50Series = ema(closes, 50);
  const rsiSeries = rsi(closes, 14);
  const ema20Value = latestDefinedValue(ema20Series) ?? current;
  const ema50Value = latestDefinedValue(ema50Series) ?? current;
  const rsiValue = latestDefinedValue(rsiSeries) ?? 50;
  const lookback = Math.min(12, Math.max(1, closes.length - 1));
  const changePct = lookback > 0 ? pctChange(closes[closes.length - 1 - lookback], current) : 0;
  let score = 0;
  score += current > ema20Value ? 10 : -10;
  score += ema20Value > ema50Value ? 12 : -12;
  score += rsiValue >= 52 && rsiValue <= 68 ? 8 : rsiValue < 45 ? -8 : 0;
  score += changePct > 1 ? 8 : changePct < -1 ? -8 : 0;

  if (score >= 16) return { label: "Bullish", tone: "up", score, rsi: rsiValue, changePct };
  if (score <= -16) return { label: "Bearish", tone: "down", score, rsi: rsiValue, changePct };
  return { label: "Balanced", tone: "neutral", score, rsi: rsiValue, changePct };
}

async function fetchTimeframeMatrix(symbol) {
  const cached = timeframeCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < TIMEFRAME_CACHE_MS) {
    return cached.summary;
  }

  const results = await Promise.allSettled(
    TIMEFRAME_CONFIG.map((config) =>
      fetchJson(
        `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${config.interval}&limit=180`,
        `${config.interval} timeframe`
      ).then((entries) => summarizeTimeframe(entries.map(mapKlineEntry)))
    )
  );

  const summary = TIMEFRAME_CONFIG.reduce((accumulator, config, index) => {
    const result = results[index];
    accumulator[config.key] =
      result.status === "fulfilled"
        ? result.value
        : { label: "Unavailable", tone: "neutral", score: 0, rsi: 50, changePct: 0 };
    return accumulator;
  }, {});

  timeframeCache.set(symbol, {
    fetchedAt: Date.now(),
    summary,
  });

  return summary;
}

function tradeTargets(candidate) {
  const entry = candidate.trade.entry;
  const stop = candidate.trade.stopLoss;
  const risk = Math.max(Math.abs(entry - stop), entry * 0.0035);
  const direction = candidate.trade.stance === "Short" ? -1 : 1;
  const tp1 = candidate.trade.takeProfit;
  const tp2 = entry + direction * risk * 2.2;
  return {
    entry,
    stop,
    tp1,
    tp2,
  };
}

function buildMarketRows(universe) {
  return universe
    .map((symbolInfo) => {
      const ticker = universeTickerMap.get(symbolInfo.symbol) || null;
      const analysis = analysisCache.get(symbolInfo.symbol) || null;
      return {
        symbol: symbolInfo.symbol,
        ticker,
        analysis,
        price: analysis?.currentPrice ?? ticker?.lastPrice ?? 0,
        changePct: ticker?.changePct ?? 0,
        quoteVolume: ticker?.quoteVolume ?? 0,
      };
    })
    .sort((left, right) => (right.quoteVolume || 0) - (left.quoteVolume || 0));
}

function buildQualityRows(candidates) {
  return candidates.slice(0, 18).map((candidate) => {
    const ticker = universeTickerMap.get(candidate.symbol) || {};
    const timeframeSummary = timeframeCache.get(candidate.symbol)?.summary || {};
    const tier = volumeTier(ticker.quoteVolume || 0);
    const signals = buildBullBearSignals(candidate, ticker, timeframeSummary);
    const quality = qualityTier(candidate.qualityScore);

    return {
      symbol: candidate.symbol,
      price: formatPrice(candidate.currentPrice, candidate.pricePrecision),
      volumeTier: tier,
      goodVolume: hasGoodTradingVolume(ticker.quoteVolume || 0) ? "Yes" : "Watch",
      tf30m: timeframeSummary["30m"] || { label: "Queue", tone: "neutral" },
      tf1h: timeframeSummary["1h"] || { label: "Queue", tone: "neutral" },
      tf4h: timeframeSummary["4h"] || { label: "Queue", tone: "neutral" },
      tf1d: timeframeSummary["1d"] || { label: "Queue", tone: "neutral" },
      bullishSignals: signals.bullishSignals.join(" • ") || "-",
      bearishSignals: signals.bearishSignals.join(" • ") || "-",
      qualityScore: candidate.qualityScore,
      qualityClass: quality.className,
      qualityLabel: quality.label,
    };
  });
}

function buildTrendingRows(universeRows) {
  return universeRows
    .map((row) => {
      const candidate = row.analysis;
      const timeframeSummary = candidate ? timeframeCache.get(candidate.symbol)?.summary || {} : {};
      const tier = volumeTier(row.quoteVolume || 0);
      const genericSignals = candidate
        ? buildBullBearSignals(candidate, row.ticker, timeframeSummary)
        : {
            bullishSignals:
              row.changePct > 0 ? [`24H change ${formatPercent(row.changePct)}`, "Momentum active"] : [],
            bearishSignals:
              row.changePct < 0 ? [`24H change ${formatPercent(row.changePct)}`, "Sellers active"] : [],
          };
      const qualityScore = candidate?.qualityScore ?? Math.round(Math.abs(row.changePct) * 2);
      const hotScore = Math.round(
        Math.abs(row.changePct) * 3 +
          (tier.label === "High Volume" ? 12 : tier.label === "Mid Cap Volume" ? 6 : 2) +
          (hasGoodTradingVolume(row.quoteVolume || 0) ? 8 : 0) +
          (candidate ? candidate.qualityScore / 2 : 0)
      );

      return {
        symbol: row.symbol,
        price: formatPrice(row.price, candidate?.pricePrecision || 4),
        changePct: row.changePct,
        tier,
        bullishSignals: genericSignals.bullishSignals.join(" • ") || "-",
        bearishSignals: genericSignals.bearishSignals.join(" • ") || "-",
        qualityScore,
        hotScore,
      };
    })
    .sort((left, right) => right.hotScore - left.hotScore)
    .slice(0, 16);
}

function renderMonitorTable(container, headers, bodyRows) {
  if (!container) return;
  if (!bodyRows.length) {
    container.innerHTML = `
      <div class="monitor-empty">
        Waiting for arena scan results...
      </div>
    `;
    return;
  }

  const head = headers.map((header) => `<th>${header}</th>`).join("");
  const body = bodyRows.join("");

  container.innerHTML = `
    <div class="monitor-table-shell">
      <table>
        <thead>
          <tr>${head}</tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function renderQualityTable(candidates) {
  const rows = buildQualityRows(candidates).map((row) => `
    <tr>
      <td><div class="monitor-symbol">${row.symbol}</div></td>
      <td>${row.price}</td>
      <td class="${row.volumeTier.tone}">${row.volumeTier.label}</td>
      <td class="${row.goodVolume === "Yes" ? "up" : "neutral"}">${row.goodVolume}</td>
      <td class="${row.tf30m.tone}">${row.tf30m.label}</td>
      <td class="${row.tf1h.tone}">${row.tf1h.label}</td>
      <td class="${row.tf4h.tone}">${row.tf4h.label}</td>
      <td class="${row.tf1d.tone}">${row.tf1d.label}</td>
      <td>${row.bullishSignals}</td>
      <td>${row.bearishSignals}</td>
      <td class="quality-column quality-column-centered">
        <span class="quality-chip ${row.qualityClass}" title="${row.qualityLabel}">
          Q${row.qualityScore}
        </span>
      </td>
    </tr>
  `);

  renderMonitorTable(
    dom.qualityTable,
    [
      "Pair",
      "Price",
      "Volume Tier",
      "Good Volume",
      "30m",
      "1H",
      "4H",
      "1D",
      "Bullish Signals",
      "Bearish Signals",
      '<span class="quality-column-heading">Final Quality</span>',
    ],
    rows
  );
}

function renderTrendingTable(universeRows) {
  const rows = buildTrendingRows(universeRows).map((row) => `
    <tr>
      <td><div class="monitor-symbol">${row.symbol}</div></td>
      <td>${row.price}</td>
      <td class="${toneFromNumber(row.changePct, 0.15)}">${formatPercent(row.changePct)}</td>
      <td class="${row.tier.tone}">${row.tier.label}</td>
      <td>${row.bullishSignals}</td>
      <td>${row.bearishSignals}</td>
      <td class="quality-column quality-column-centered">
        <span class="quality-chip ${qualityTier(row.qualityScore).className}">
          Q${row.qualityScore}
        </span>
      </td>
      <td class="${row.hotScore >= 80 ? "up" : row.hotScore >= 55 ? "neutral" : "down"}">${row.hotScore}</td>
    </tr>
  `);

  renderMonitorTable(
    dom.trendingTable,
    [
      "Pair",
      "Price",
      "24H",
      "Volume Tier",
      "Bullish Signals",
      "Bearish Signals",
      '<span class="quality-column-heading">Quality</span>',
      "Hot Score",
    ],
    rows
  );
}

function renderQualityFramework(universeRows) {
  const goodLiquidityCount = universeRows.filter((row) => hasGoodTradingVolume(row.quoteVolume)).length;
  renderAnalysisGrid(dom.qualityFramework, [
    {
      label: "Good Trading Volume",
      value: `${goodLiquidityCount}`,
      note: "Pairs above the liquidity floor are allowed to compete for top quality slots.",
      tone: "up",
    },
    {
      label: "Volume Categories",
      value: "High / Mid / Low",
      note: "Every pair is bucketed by 24H quote volume before conviction is assigned.",
      tone: "neutral",
    },
    {
      label: "Trend Structure",
      value: "EMA + RSI",
      note: "Fast-vs-slow trend plus momentum condition score each setup.",
      tone: "up",
    },
    {
      label: "Order Flow",
      value: "CVD + Taker",
      note: "Aggressive buy/sell flow confirms whether price is attracting real pressure.",
      tone: "neutral",
    },
    {
      label: "Leverage Posture",
      value: "OI + Funding",
      note: "Open-interest expansion and funding crowding raise or cut conviction.",
      tone: "neutral",
    },
    {
      label: "Multi-Timeframe",
      value: "30m • 1H • 4H • 1D",
      note: "Short-term and long-term plays require alignment across these windows.",
      tone: "up",
    },
  ]);
}

function renderTabs() {
  const isSelection = state.activeTab === "selection";
  const isQuality = state.activeTab === "quality";
  const isTrending = state.activeTab === "trending";

  if (dom.tabSelection) dom.tabSelection.classList.toggle("is-active", isSelection);
  dom.tabQuality.classList.toggle("is-active", isQuality);
  dom.tabTrending.classList.toggle("is-active", isTrending);
  if (dom.selectionPanel) dom.selectionPanel.hidden = !isSelection;
  dom.qualityPanel.hidden = !isQuality;
  dom.trendingPanel.hidden = !isTrending;
  dom.tabNote.textContent = isSelection
    ? "Signal board keeps the highest-ranked arena candidates visible with cleaner priority ordering."
    : isQuality
      ? "Quality scoring explains why a pair earns priority: liquidity, trend, flow, leverage, and timeframe agreement."
      : "Hot trending pairs are refreshed every 5 minutes, with manual refresh available at any time.";
}

function buildConvictionCollections(candidates) {
  const shortTerm = [];
  const longTerm = [];

  candidates.forEach((candidate) => {
    const summary = timeframeCache.get(candidate.symbol)?.summary;
    if (!summary) return;

    const shortAligned =
      summary["30m"]?.tone === candidate.bias.tone && summary["1h"]?.tone === candidate.bias.tone;
    const longAligned =
      summary["4h"]?.tone === candidate.bias.tone && summary["1d"]?.tone === candidate.bias.tone;

    const entry = {
      candidate,
      summary,
      score:
        candidate.qualityScore +
        (summary["30m"]?.score || 0) / 3 +
        (summary["1h"]?.score || 0) / 3 +
        (summary["4h"]?.score || 0) / 3 +
        (summary["1d"]?.score || 0) / 3,
    };

    if (shortAligned) shortTerm.push(entry);
    if (longAligned) longTerm.push(entry);
  });

  shortTerm.sort((left, right) => right.score - left.score);
  longTerm.sort((left, right) => right.score - left.score);
  return {
    shortTerm: shortTerm.slice(0, 3),
    longTerm: longTerm.slice(0, 3),
  };
}

function convictionCard(entry, horizon) {
  const candidate = entry.candidate;
  const summary = entry.summary;
  const targets = tradeTargets(candidate);
  const timeframeLine =
    horizon === "short"
      ? `30m ${summary["30m"].label} • 1H ${summary["1h"].label}`
      : `4H ${summary["4h"].label} • 1D ${summary["1d"].label}`;
  const volumeLine = volumeTier((universeTickerMap.get(candidate.symbol)?.quoteVolume) || 0).label;

  return {
    label: `${candidate.symbol} • ${candidate.trade.stance}`,
    value: `TP ${formatPrice(targets.tp1, candidate.pricePrecision)} • SL ${formatPrice(
      targets.stop,
      candidate.pricePrecision
    )}`,
    note: `${timeframeLine} • ${volumeLine} • ${candidate.bias.label}. ${candidate.trade.stance} idea from flow, trend, and RR ${candidate.rr.toFixed(2)}.`,
    tone: candidate.bias.tone,
  };
}

function summarizeEngine(candidates) {
  const qualified = highQualityCandidates(candidates, state.qualityThreshold);
  if (!qualified.length) {
    return `No pair currently clears the arena quality threshold of ${state.qualityThreshold}. The engine is still rotating the full perp universe every 5 minutes.`;
  }
  const best = qualified[0];
  return `${qualified.length} pairs currently clear the arena quality bar. ${best.symbol} leads with quality ${best.qualityScore}, ${best.bias.label.toLowerCase()} bias, and ${best.rr.toFixed(2)}R reward-to-risk.`;
}

function renderArena(universe) {
  const universeRows = buildMarketRows(universe);
  const qualified = highQualityCandidates(state.lastCandidates, state.qualityThreshold);
  const highVolumeCount = universeRows.filter((row) => volumeTier(row.quoteVolume).label === "High Volume").length;
  const midVolumeCount = universeRows.filter((row) => volumeTier(row.quoteVolume).label === "Mid Cap Volume").length;
  const lowVolumeCount = universeRows.length - highVolumeCount - midVolumeCount;
  const conviction = buildConvictionCollections(state.lastCandidates.slice(0, 18));

  dom.universeInput.value = "All Binance USDT Perps";
  dom.cycleInput.value = "Every 5 minutes";
  dom.metricUniverse.textContent = `${universe.length}`;
  dom.metricUniverseNote.textContent = "Tradable Binance perpetuals";
  dom.metricHighVolume.textContent = `${highVolumeCount}`;
  dom.metricHighVolume.className = "up";
  dom.metricHighVolumeNote.textContent = tickerFeedState.degraded
    ? `Fallback feed: ${tickerFeedState.source}`
    : "Best liquidity bucket";
  dom.metricMidVolume.textContent = `${midVolumeCount}`;
  dom.metricMidVolume.className = "neutral";
  dom.metricMidVolumeNote.textContent = tickerFeedState.degraded
    ? "Estimated from fallback ticker data"
    : "Secondary flow bucket";
  dom.metricLowVolume.textContent = `${lowVolumeCount}`;
  dom.metricLowVolume.className = "down";
  dom.metricLowVolumeNote.textContent = tickerFeedState.degraded
    ? "Price-only or cached rows still stay in rotation"
    : "Thin but still monitored";
  dom.metricQualified.textContent = `${qualified.length}`;
  dom.metricQualified.className = qualified.length ? "up" : "neutral";
  dom.metricQualifiedNote.textContent = `Quality >= ${state.qualityThreshold} and RR >= 1.2`;
  dom.metricLastScan.textContent = state.lastScanAt ? formatClock(state.lastScanAt) : "-";
  dom.metricLastScanNote.textContent = tickerFeedState.degraded
    ? `${tickerFeedState.source} • auto scan every 5m`
    : "Auto scan every 5m";
  dom.engineSummary.textContent = summarizeEngine(state.lastCandidates);
  dom.refreshNote.textContent = state.lastScanAt
    ? `Last refresh ${formatClock(state.lastScanAt)} • auto 5m`
    : "First scan pending";

  renderAnalysisGrid(
    dom.candidateGrid,
    state.lastCandidates.slice(0, 6).map((candidate) => {
      const ticker = universeTickerMap.get(candidate.symbol) || {};
      const tier = volumeTier(ticker.quoteVolume || 0);
      return {
        label: candidate.symbol,
        value: `${candidate.bias.label} • Q${candidate.qualityScore}`,
        note: `${formatPrice(candidate.currentPrice, candidate.pricePrecision)} • ${tier.label} • RR ${candidate.rr.toFixed(2)} • CVD ${formatPercent(candidate.cvdSlope)} • OI ${formatPercent(candidate.oiChange1h)}`,
        tone: candidate.bias.tone,
      };
    })
  );

  renderAnalysisGrid(
    dom.shortTermGrid,
    conviction.shortTerm.length
      ? conviction.shortTerm.map((entry) => convictionCard(entry, "short"))
      : [
          {
            label: "Short term",
            value: "Waiting",
            note: "No pair has clean 30m and 1H alignment yet.",
            tone: "neutral",
          },
        ]
  );

  renderAnalysisGrid(
    dom.longTermGrid,
    conviction.longTerm.length
      ? conviction.longTerm.map((entry) => convictionCard(entry, "long"))
      : [
          {
            label: "Long term",
            value: "Waiting",
            note: "No pair has clean 4H and 1D alignment yet.",
            tone: "neutral",
          },
        ]
  );

  renderQualityFramework(universeRows);
  renderQualityTable(state.lastCandidates);
  renderTrendingTable(universeRows);
  renderTabs();
}

async function refreshTimeframes(candidates, universeRows) {
  const trendingSymbols = universeRows
    .sort((left, right) => Math.abs(right.changePct) - Math.abs(left.changePct))
    .slice(0, 10)
    .map((row) => row.symbol);
  const symbols = Array.from(
    new Set([...candidates.slice(0, 18).map((candidate) => candidate.symbol), ...trendingSymbols])
  );

  await mapWithConcurrency(symbols, TIMEFRAME_CONCURRENCY, async (symbol) => {
    try {
      await fetchTimeframeMatrix(symbol);
    } catch (error) {
      console.error("timeframe fetch failed", symbol, error);
    }
  });
}

async function scanArena({ manual = false } = {}) {
  if (scanning) return;
  scanning = true;
  setStatus("Scanning full perp universe for conviction and hot rotations...", "neutral");

  try {
    const universe = await getPerpUniverse();
    const tickers = await fetchUniverseTickers();
    universeTickerMap = buildTickerLookup(tickers);
    const batch = selectUniverseBatch(universe);

    const results = await mapWithConcurrency(batch, ANALYSIS_CONCURRENCY, async (symbolInfo) => {
      try {
        return analyzeSnapshot(await fetchEngineSnapshot(symbolInfo.symbol, BASE_INTERVAL));
      } catch (error) {
        return null;
      }
    });

    results.filter(Boolean).forEach((candidate) => {
      analysisCache.set(candidate.symbol, {
        ...candidate,
        analyzedAt: Date.now(),
      });
    });

    state.lastCandidates = Array.from(analysisCache.values())
      .sort((left, right) => right.qualityScore - left.qualityScore)
      .slice(0, 48);
    state.lastScanAt = Date.now();

    const universeRows = buildMarketRows(universe);
    await refreshTimeframes(state.lastCandidates, universeRows);

    renderArena(universe);
    persistState();

    const qualified = highQualityCandidates(state.lastCandidates, state.qualityThreshold);
    const baseMessage = qualified.length
      ? `${qualified.length} arena setups currently qualify. ${qualified[0].symbol} is leading the board.`
      : manual
        ? "Manual arena refresh complete. No pair currently clears the active quality bar."
        : "Arena scan complete. Waiting for a stronger setup cluster.";
    const degradationNote = tickerFeedState.degraded
      ? ` Using ${tickerFeedState.source} because Binance blocked the bulk 24H ticker feed.`
      : "";

    setStatus(`${baseMessage}${degradationNote}`, qualified.length ? qualified[0].bias.tone : "neutral");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Trading Arena scan failed.", "down");
  } finally {
    scanning = false;
  }
}

function scheduleArenaScan() {
  if (scanTimer) window.clearInterval(scanTimer);
  scanTimer = window.setInterval(() => {
    scanArena();
  }, AUTO_SCAN_MS);
}

function syncControls() {
  dom.qualityThreshold.value = `${state.qualityThreshold}`;
}

dom.arenaForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.qualityThreshold = Math.max(50, Number(dom.qualityThreshold.value) || DEFAULT_QUALITY_THRESHOLD);
  persistState();
  scanArena({ manual: true });
});

dom.refreshButton.addEventListener("click", () => {
  scanArena({ manual: true });
});

if (dom.tabSelection) {
  dom.tabSelection.addEventListener("click", () => {
    state.activeTab = "selection";
    persistState();
    renderTabs();
  });
}

dom.tabQuality.addEventListener("click", () => {
  state.activeTab = "quality";
  persistState();
  renderTabs();
});

dom.tabTrending.addEventListener("click", () => {
  state.activeTab = "trending";
  persistState();
  renderTabs();
});

syncControls();
renderTabs();
renderAnalysisGrid(dom.shortTermGrid, []);
renderAnalysisGrid(dom.longTermGrid, []);
renderAnalysisGrid(dom.candidateGrid, []);
scheduleArenaScan();
scanArena();
