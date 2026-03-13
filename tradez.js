const DEFAULT_TOKEN = "BTC";
const STRATEGY_INTERVAL = "1h";
const QUOTE_ASSET = "USDT";
const DEFAULT_QUALITY_THRESHOLD = 78;
const AUTO_SCAN_MS = 5 * 60 * 1000;
const PRIORITY_SCAN_COUNT = 12;
const ROTATION_SCAN_COUNT = 20;
const ANALYSIS_CONCURRENCY = 5;
const STORAGE_KEY = "apex-signals-tradez-state";
const ALERT_EVENTS_KEY = "apex-signals-tradez-alert-events";
const SIGNAL_IDS_KEY = "apex-signals-tradez-seen-signal-ids";
const TICKER_STORAGE_KEY = "apex-signals-tradez-tickers";
const TICKER_CACHE_MAX_AGE_MS = 30 * 60 * 1000;

const dom = {
  form: document.getElementById("tradez-form"),
  tokenInput: document.getElementById("tradez-token-input"),
  qualityThreshold: document.getElementById("tradez-quality-threshold"),
  refreshSubmit: document.getElementById("tradez-refresh-submit"),
  scanButton: document.getElementById("tradez-scan-button"),
  alertPermissionButton: document.getElementById("tradez-alert-permission"),
  autoNote: document.getElementById("tradez-auto-note"),
  statusBanner: document.getElementById("tradez-status-banner"),
  metricSelected: document.getElementById("tradez-metric-selected"),
  metricSelectedNote: document.getElementById("tradez-metric-selected-note"),
  metricQualified: document.getElementById("tradez-metric-qualified"),
  metricQualifiedNote: document.getElementById("tradez-metric-qualified-note"),
  metricBullish: document.getElementById("tradez-metric-bullish"),
  metricBullishNote: document.getElementById("tradez-metric-bullish-note"),
  metricBearish: document.getElementById("tradez-metric-bearish"),
  metricBearishNote: document.getElementById("tradez-metric-bearish-note"),
  metricAlerts: document.getElementById("tradez-metric-alerts"),
  metricAlertsNote: document.getElementById("tradez-metric-alerts-note"),
  metricLastScan: document.getElementById("tradez-metric-last-scan"),
  metricLastScanNote: document.getElementById("tradez-metric-last-scan-note"),
  assetTitle: document.getElementById("tradez-asset-title"),
  assetSubtitle: document.getElementById("tradez-asset-subtitle"),
  headlinePrice: document.getElementById("tradez-headline-price"),
  headlineChange: document.getElementById("tradez-headline-change"),
  headlineBias: document.getElementById("tradez-headline-bias"),
  chart: document.getElementById("tradez-chart"),
  chartEma20: document.getElementById("tradez-chart-ema20"),
  chartEma50: document.getElementById("tradez-chart-ema50"),
  chartRsi: document.getElementById("tradez-chart-rsi"),
  chartVolume: document.getElementById("tradez-chart-volume"),
  chartLineLabelEma20: document.getElementById("tradez-chart-line-label-ema20"),
  chartLineLabelEma50: document.getElementById("tradez-chart-line-label-ema50"),
  supportFields: document.getElementById("tradez-support-fields"),
  resistanceFields: document.getElementById("tradez-resistance-fields"),
  qualityBadge: document.getElementById("tradez-quality-badge"),
  streamStatus: document.getElementById("tradez-stream-status"),
  summaryCopy: document.getElementById("tradez-summary-copy"),
  stancePill: document.getElementById("tradez-stance-pill"),
  entryZone: document.getElementById("tradez-entry-zone"),
  stop: document.getElementById("tradez-stop"),
  tp1: document.getElementById("tradez-tp1"),
  tp2: document.getElementById("tradez-tp2"),
  tradeSummary: document.getElementById("tradez-trade-summary"),
  planNote: document.getElementById("tradez-plan-note"),
  signalList: document.getElementById("tradez-signal-list"),
  tabSignals: document.getElementById("tradez-tab-signals"),
  tabAlerts: document.getElementById("tradez-tab-alerts"),
  tabNotes: document.getElementById("tradez-tab-notes"),
  tabNote: document.getElementById("tradez-tab-note"),
  panelSignals: document.getElementById("tradez-panel-signals"),
  panelAlerts: document.getElementById("tradez-panel-alerts"),
  panelNotes: document.getElementById("tradez-panel-notes"),
  signalTable: document.getElementById("tradez-signal-table"),
  alertTable: document.getElementById("tradez-alert-table"),
  notesGrid: document.getElementById("tradez-notes-grid"),
};

const state = loadState();

let chart;
let candleSeries;
let volumeSeries;
let ema20LineSeries;
let ema50LineSeries;
let priceLines = [];
let scanTimer = null;
let scanCursor = 0;
let exchangeInfoCache = null;
let perpUniverseCache = null;
let universeTickerMap = new Map();
let candidateMap = new Map();
let latestBatchMap = new Map();
let chartResizeBound = false;

function loadState() {
  const stored = readStoredJson(STORAGE_KEY, {});
  return {
    selectedToken: stored.selectedToken || DEFAULT_TOKEN,
    selectedSymbol: stored.selectedSymbol || null,
    qualityThreshold: Number(stored.qualityThreshold) || DEFAULT_QUALITY_THRESHOLD,
    activeTab: stored.activeTab || "signals",
    lastScanAt: Number(stored.lastScanAt) || 0,
    alertEvents: readStoredJson(ALERT_EVENTS_KEY, []).slice(0, 36),
    seenSignalIds: new Set(readStoredJson(SIGNAL_IDS_KEY, [])),
    candidates: [],
    chartAnalysis: null,
    chartSnapshot: null,
    alertPermission: typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  };
}

function persistState() {
  writeStoredJson(STORAGE_KEY, {
    selectedToken: state.selectedToken,
    selectedSymbol: state.selectedSymbol,
    qualityThreshold: state.qualityThreshold,
    activeTab: state.activeTab,
    lastScanAt: state.lastScanAt,
  });
  writeStoredJson(ALERT_EVENTS_KEY, state.alertEvents.slice(0, 36));
  writeStoredJson(SIGNAL_IDS_KEY, Array.from(state.seenSignalIds).slice(-200));
}

function readStoredJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeStoredJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Ignore storage write failures.
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

function setStreamStatus(message, tone = "neutral") {
  dom.streamStatus.textContent = message;
  dom.streamStatus.className = `stream-status ${tone}`;
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

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
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

function volumeTier(quoteVolume) {
  if (quoteVolume >= 750_000_000) return { label: "High Volume", tone: "up" };
  if (quoteVolume >= 100_000_000) return { label: "Mid Cap Volume", tone: "neutral" };
  return { label: "Low Cap Volume", tone: "down" };
}

function hasGoodTradingVolume(quoteVolume) {
  return Number(quoteVolume) >= 50_000_000;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index];
}

function pctChange(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === 0) return 0;
  return ((end - start) / Math.abs(start)) * 100;
}

function pctChangeFromLookback(values, lookback) {
  if (values.length <= lookback) return 0;
  return pctChange(values[values.length - 1 - lookback], values[values.length - 1]);
}

function slopePercentage(values, lookback = 10) {
  const filtered = values.filter((value) => value != null);
  if (filtered.length <= lookback) return 0;
  return pctChange(filtered[filtered.length - 1 - lookback], filtered[filtered.length - 1]);
}

function latestDefinedValue(values) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] != null) return values[index];
  }
  return null;
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

function formatCompactNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: digits,
  }).format(value);
}

function formatClock(timestamp) {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTime(timestamp) {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toneFromNumber(value, flatBand = 0.02) {
  if (!Number.isFinite(value)) return "neutral";
  if (value > flatBand) return "up";
  if (value < -flatBand) return "down";
  return "neutral";
}

function qualityTier(score) {
  if (!Number.isFinite(score)) return { className: "quality-tier-neutral", label: "Unscored" };
  if (score >= 200) return { className: "quality-tier-shining-gold", label: "Elite" };
  if (score >= 100) return { className: "quality-tier-gold", label: "Prime" };
  if (score >= 80) return { className: "quality-tier-green", label: "Strong" };
  if (score >= 60) return { className: "quality-tier-light-orange", label: "Watch" };
  if (score >= 40) return { className: "quality-tier-orange", label: "Weak" };
  return { className: "quality-tier-red", label: "Poor" };
}

function createPill(text, tone) {
  const pill = document.createElement("span");
  pill.className = `pill ${tone}`;
  pill.textContent = text;
  return pill;
}

function renderLevelBands(container, levels, bandWidth, tone, precisionHint) {
  container.innerHTML = "";
  if (!levels.length) {
    container.appendChild(createPill("No clear level", "neutral"));
    return;
  }

  levels.forEach((level) => {
    const low = level - bandWidth;
    const high = level + bandWidth;
    container.appendChild(
      createPill(`${formatPrice(low, precisionHint)} - ${formatPrice(high, precisionHint)}`, tone)
    );
  });
}

function renderSignalList(items) {
  dom.signalList.innerHTML = "";
  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "signal-item";
    card.innerHTML = `
      <span>${item.label}</span>
      <strong class="${item.tone || "neutral"}">${item.value}</strong>
      <small>${item.note}</small>
    `;
    dom.signalList.appendChild(card);
  });
}

function renderAnalysisGrid(container, items) {
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

  function uniqueDirectionalLevels(baseLevels, fallbackLevels, direction) {
    const sorted = [...baseLevels];
    const orderedFallback = [...fallbackLevels].sort((left, right) =>
      direction === "support" ? right - left : left - right
    );

    orderedFallback.forEach((level) => {
      if (
        !sorted.some((existing) => Math.abs(existing - level) <= Math.max(clusterThreshold * 0.65, 0.0000001))
      ) {
        sorted.push(level);
      }
    });

    return sorted
      .filter((level) => (direction === "support" ? level < currentPrice : level > currentPrice))
      .sort((left, right) => (direction === "support" ? right - left : left - right))
      .slice(0, 2);
  }

  const recentWindow = candles.slice(-Math.min(candles.length, 90));
  const clusteredSupports = clusterLevels(supports).filter((level) => level < currentPrice);
  const clusteredResistances = clusterLevels(resistances).filter((level) => level > currentPrice);
  const fallbackSupports = clusterLevels(recentWindow.map((candle) => candle.low)).filter(
    (level) => level < currentPrice
  );
  const fallbackResistances = clusterLevels(recentWindow.map((candle) => candle.high)).filter(
    (level) => level > currentPrice
  );

  const recentHigh = recentWindow.length ? Math.max(...recentWindow.map((candle) => candle.high)) : currentPrice;
  const recentLow = recentWindow.length ? Math.min(...recentWindow.map((candle) => candle.low)) : currentPrice;
  const projectionUnit = Math.max(
    clusterThreshold * 1.2,
    latestAtr * 0.9,
    Math.abs(recentHigh - recentLow) * 0.16
  );

  let supportLevels = uniqueDirectionalLevels(clusteredSupports, fallbackSupports, "support");
  let resistanceLevels = uniqueDirectionalLevels(clusteredResistances, fallbackResistances, "resistance");

  while (supportLevels.length < 2) {
    const anchor = supportLevels[supportLevels.length - 1] ?? currentPrice;
    supportLevels.push(anchor - projectionUnit * (supportLevels.length === 0 ? 1 : 0.9));
  }

  while (resistanceLevels.length < 2) {
    const anchor = resistanceLevels[resistanceLevels.length - 1] ?? currentPrice;
    resistanceLevels.push(anchor + projectionUnit * (resistanceLevels.length === 0 ? 1 : 0.9));
  }

  return {
    supportLevels: supportLevels.sort((left, right) => right - left).slice(0, 2),
    resistanceLevels: resistanceLevels.sort((left, right) => left - right).slice(0, 2),
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
  if (!normalizedTrades.length) {
    return {
      totalBuyNotional: 0,
      totalSellNotional: 0,
      netLargeFlow: 0,
      cvdSlope: 0,
    };
  }

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
        accumulator.netLargeFlow += trade.isSellInitiated ? -trade.quoteNotional : trade.quoteNotional;
      }

      return accumulator;
    },
    {
      totalBuyNotional: 0,
      totalSellNotional: 0,
      netLargeFlow: 0,
    }
  );

  return {
    ...summary,
    cvdSlope: slopePercentage(cvdSeries, 40),
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

async function fetchJson(url, label) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`${label} failed (${response.status})`);
  }

  return response.json();
}

async function fetchDirectJson(url, label) {
  const response = await fetch(url);
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
  if (!response.ok) throw new Error(payload.error || `Arena ticker proxy failed (${response.status})`);
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
    persistTickers(tickers);
    return tickers;
  } catch (directError) {
    try {
      const tickers = await fetchUniverseTickersServer(activeSymbols);
      if (tickers.length) persistTickers(tickers);
      return tickers;
    } catch (serverError) {
      if (cachedTickers?.length) return cachedTickers;
      try {
        return await fetchUniversePricesFallback(activeSymbols);
      } catch (priceError) {
        return buildShellTickers(activeSymbols);
      }
    }
  }
}

async function fetchServerSnapshot(token) {
  const requestUrl = new URL("/api/market", window.location.origin);
  requestUrl.searchParams.set("token", normalizeToken(token));
  requestUrl.searchParams.set("interval", STRATEGY_INTERVAL);
  const response = await fetch(requestUrl);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Server snapshot failed");
  return payload;
}

async function fetchDirectSnapshot(token) {
  const exchangeInfo = await getExchangeInfo();
  const resolved = resolvePerpSymbol(token, exchangeInfo);

  const requests = await Promise.allSettled([
    fetchDirectJson(
      `https://fapi.binance.com/fapi/v1/klines?symbol=${resolved.symbol}&interval=${STRATEGY_INTERVAL}&limit=240`,
      "Klines"
    ),
    fetchDirectJson(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${resolved.symbol}`, "Ticker"),
    fetchDirectJson(`https://fapi.binance.com/fapi/v1/depth?symbol=${resolved.symbol}&limit=100`, "Depth"),
    fetchDirectJson(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=${resolved.symbol}&limit=400`, "Trades"),
    fetchDirectJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${resolved.symbol}`, "Premium"),
    fetchDirectJson(
      `https://fapi.binance.com/futures/data/openInterestHist?symbol=${resolved.symbol}&period=5m&limit=60`,
      "OI history"
    ),
    fetchDirectJson(
      `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${resolved.symbol}&period=1h&limit=24`,
      "Global L/S"
    ),
    fetchDirectJson(
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
  };
}

async function fetchEngineSnapshot(token) {
  try {
    return await fetchDirectSnapshot(token);
  } catch (error) {
    return fetchServerSnapshot(token);
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
    const leftTicker = universeTickerMap.get(left.symbol);
    const rightTicker = universeTickerMap.get(right.symbol);
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

function touchLabel(touch20, touch50) {
  if (touch20 && touch50) return "EMA20/50";
  if (touch20) return "EMA20";
  if (touch50) return "EMA50";
  return "EMA zone";
}

function rangePosition(candle, side) {
  const candleRange = Math.max(candle.high - candle.low, 0.0000001);
  if (side === "Long") return (candle.close - candle.low) / candleRange;
  return (candle.high - candle.close) / candleRange;
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
  const closes = candles.map((candle) => candle.close);
  const currentPrice = Number(snapshot.premiumIndex?.markPrice) || Number(snapshot.ticker?.lastPrice) || closes[closes.length - 1] || 0;
  const ema20Series = ema(closes, 20);
  const ema50Series = ema(closes, 50);
  const rsiSeries = rsi(closes, 14);
  const atrSeries = atr(candles, 14);
  const latestEma20 = latestDefinedValue(ema20Series) ?? currentPrice;
  const latestEma50 = latestDefinedValue(ema50Series) ?? currentPrice;
  const latestRsi = latestDefinedValue(rsiSeries) ?? 50;
  const latestAtr = latestDefinedValue(atrSeries) ?? currentPrice * 0.01;
  const supportResistance = computeSupportResistance(candles, currentPrice, latestAtr);
  const tradeSummary = analyzeTradeTape(snapshot.trades || []);
  const depthSummary = analyzeOrderbook(snapshot.depth || { bids: [], asks: [] }, currentPrice);
  const takerSummary = analyzeTakerLongShort(snapshot.takerLongShort || []);
  const oiHistory = (snapshot.openInterestHistory || []).map((entry) => Number(entry.sumOpenInterest));
  const oiChange1h = pctChangeFromLookback(oiHistory, 12);
  const fundingRate = (Number(snapshot.premiumIndex?.lastFundingRate) || 0) * 100;
  const bias = buildSetupBias(currentPrice, latestEma20, latestEma50, latestRsi);
  const completedLimit = Math.max(55, candles.length - 10);
  const markers = [];
  const historicalSignals = [];
  let activeSignal = null;

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
    const tolerance = Math.max(atrValue * 0.16, candle.close * 0.0012);
    const touch20 = candle.low <= ema20Value + tolerance && candle.high >= ema20Value - tolerance;
    const touch50 = candle.low <= ema50Value + tolerance && candle.high >= ema50Value - tolerance;
    if (!touch20 && !touch50) continue;

    const longSetup =
      bullishTrend &&
      candle.low <= Math.max(ema20Value, ema50Value) + tolerance &&
      candle.close >= ema20Value - tolerance * 0.2 &&
      (candle.close > candle.open || (nextCandle && nextCandle.close > candle.close));
    const shortSetup =
      bearishTrend &&
      candle.high >= Math.min(ema20Value, ema50Value) - tolerance &&
      candle.close <= ema20Value + tolerance * 0.2 &&
      (candle.close < candle.open || (nextCandle && nextCandle.close < candle.close));

    if (!longSetup && !shortSetup) continue;

    const side = longSetup ? "Long" : "Short";
    const tone = side === "Long" ? "up" : "down";
    const averageVolume20 = average(candles.slice(Math.max(0, index - 20), index).map((entry) => entry.volume).filter(Boolean));
    const volumeFactor = averageVolume20 ? candle.volume / averageVolume20 : 1;
    const entryLow = Math.min(ema20Value, ema50Value) - tolerance * 0.35;
    const entryHigh = Math.max(ema20Value, ema50Value) + tolerance * 0.35;
    const entryReference = average([entryLow, entryHigh]);
    const nearestSupport = supportResistance.supportLevels[0] ?? entryReference - atrValue * 1.1;
    const nearestResistance = supportResistance.resistanceLevels[0] ?? entryReference + atrValue * 1.1;
    const stopLoss =
      side === "Long"
        ? Math.min(candle.low, nearestSupport) - atrValue * 0.24
        : Math.max(candle.high, nearestResistance) + atrValue * 0.24;
    const risk = Math.max(Math.abs(entryReference - stopLoss), atrValue * 0.55);
    const tp1 =
      side === "Long"
        ? Math.max(nearestResistance, entryReference + risk * 1.65)
        : Math.min(nearestSupport, entryReference - risk * 1.65);
    const tp2 = side === "Long" ? entryReference + risk * 2.45 : entryReference - risk * 2.45;
    const room = side === "Long" ? tp1 - currentPrice : currentPrice - tp1;
    const rr = Math.abs(tp1 - entryReference) / Math.max(risk, 0.0000001);
    const recentDistancePct = Math.abs(pctChange(entryReference, currentPrice));
    const sinceTouchBars = candles.length - 2 - index;
    let qualityScore = 34;
    qualityScore += touch20 && touch50 ? 22 : touch20 ? 18 : 16;
    qualityScore += side === "Long" ? 20 : 20;
    qualityScore += (side === "Long" ? candle.close > candle.open : candle.close < candle.open) ? 10 : 0;
    qualityScore += rangePosition(candle, side) >= 0.62 ? 8 : -6;
    qualityScore += volumeFactor >= 1.3 ? 12 : volumeFactor >= 1 ? 6 : -4;
    qualityScore += hasGoodTradingVolume(quoteVolume) ? 10 : -10;
    qualityScore += side === "Long" ? (tradeSummary.cvdSlope > 0 ? 10 : -8) : tradeSummary.cvdSlope < 0 ? 10 : -8;
    qualityScore += side === "Long" ? (depthSummary.imbalance > 0 ? 6 : -6) : depthSummary.imbalance < 0 ? 6 : -6;
    qualityScore += side === "Long" ? (takerSummary.latestRatio > 1.01 ? 8 : -6) : takerSummary.latestRatio < 0.99 ? 8 : -6;
    qualityScore += side === "Long" ? (oiChange1h > 0 ? 8 : -6) : oiChange1h > 0 ? 6 : 0;
    qualityScore += side === "Long"
      ? latestRsi >= 50 && latestRsi <= 68
        ? 8
        : latestRsi > 74
          ? -10
          : 0
      : latestRsi <= 50 && latestRsi >= 32
        ? 8
        : latestRsi < 26
          ? -10
          : 0;
    qualityScore += rr >= 2 ? 16 : rr >= 1.4 ? 8 : -10;
    qualityScore += room / Math.max(risk, 0.0000001) >= 1.5 ? 8 : -10;
    qualityScore -= sinceTouchBars * 4;
    if (recentDistancePct > 1.1) qualityScore -= 14;
    if (Math.abs(fundingRate) > 0.04 && ((side === "Long" && fundingRate > 0) || (side === "Short" && fundingRate < 0))) {
      qualityScore -= 6;
    }

    const signal = {
      id: `${snapshot.symbol}:${side}:${touchLabel(touch20, touch50)}:${candle.time}`,
      time: candle.time,
      detectedAt: candle.time * 1000,
      symbol: snapshot.symbol,
      token: snapshot.token,
      side,
      tone,
      touch: touchLabel(touch20, touch50),
      qualityScore: Math.max(0, Math.round(qualityScore)),
      entryLow,
      entryHigh,
      stopLoss,
      tp1,
      tp2,
      rr,
      sinceTouchBars,
      recentDistancePct,
      volumeFactor,
      note:
        side === "Long"
          ? `${touchLabel(touch20, touch50)} retest held while EMA20 stays above EMA50.`
          : `${touchLabel(touch20, touch50)} retest failed while EMA20 stays below EMA50.`,
      reasonParts: [
        hasGoodTradingVolume(quoteVolume) ? "good liquidity" : "thin liquidity",
        volumeFactor >= 1 ? "touch candle volume confirmed" : "volume soft",
        side === "Long" ? (tradeSummary.cvdSlope > 0 ? "CVD supportive" : "CVD soft") : tradeSummary.cvdSlope < 0 ? "CVD supportive" : "CVD soft",
        side === "Long" ? (takerSummary.latestRatio > 1 ? "buyers active" : "buyers not leading") : takerSummary.latestRatio < 1 ? "sellers active" : "sellers not leading",
      ],
    };

    historicalSignals.push(signal);
    markers.push({
      time: candle.time,
      position: side === "Long" ? "belowBar" : "aboveBar",
      color: side === "Long" ? "#35c282" : "#e04c4c",
      shape: "circle",
      text: `${side === "Long" ? "L" : "S"}${touch20 && !touch50 ? "20" : touch50 && !touch20 ? "50" : "Z"}`,
    });

    if (!activeSignal && signal.sinceTouchBars <= 3) {
      activeSignal = signal;
    } else if (signal.sinceTouchBars <= 3 && signal.qualityScore > (activeSignal?.qualityScore || 0)) {
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
    ema20LineData: candles
      .map((candle, index) => (ema20Series[index] == null ? null : { time: candle.time, value: ema20Series[index] }))
      .filter(Boolean),
    ema50LineData: candles
      .map((candle, index) => (ema50Series[index] == null ? null : { time: candle.time, value: ema50Series[index] }))
      .filter(Boolean),
    markers: markers.slice(-12),
    historicalSignals: historicalSignals.slice(-10),
    activeSignal,
    qualityScore: activeSignal?.qualityScore ?? 0,
    candles,
  };
}

function buildSignalCards(analysis) {
  const active = analysis.activeSignal;
  if (!active) {
    return [
      {
        label: "Status",
        value: "No fresh setup",
        note: "The last few 1H candles did not produce a clean EMA pullback confirmation.",
        tone: "neutral",
      },
      {
        label: "Trend stack",
        value: analysis.setupBias.label,
        note: analysis.setupBias.summary,
        tone: analysis.setupBias.tone,
      },
      {
        label: "Volume tier",
        value: volumeTier(universeTickerMap.get(analysis.symbol)?.quoteVolume || 0).label,
        note: "Liquidity still matters because weak names slip through EMAs more often.",
        tone: volumeTier(universeTickerMap.get(analysis.symbol)?.quoteVolume || 0).tone,
      },
    ];
  }

  return [
    {
      label: "Touch zone",
      value: active.touch,
      note: `${active.sinceTouchBars} bars since touch • ${active.reasonParts[0]}`,
      tone: active.tone,
    },
    {
      label: "Momentum",
      value: active.tone === "up" ? "Buyers leading" : "Sellers leading",
      note: `${active.reasonParts[2]} • ${active.reasonParts[3]}`,
      tone: active.tone,
    },
    {
      label: "Reward to risk",
      value: `${active.rr.toFixed(2)}R`,
      note: `Entry zone around ${formatPrice(active.entryLow, analysis.pricePrecision)} to ${formatPrice(active.entryHigh, analysis.pricePrecision)}`,
      tone: active.rr >= 1.5 ? "up" : "neutral",
    },
  ];
}

function volumeColor(candle) {
  return candle.close >= candle.open ? "rgba(17, 187, 109, 0.4)" : "rgba(224, 76, 76, 0.38)";
}

function initChart() {
  chart = LightweightCharts.createChart(dom.chart, {
    width: dom.chart.clientWidth,
    height: dom.chart.clientHeight,
    layout: {
      background: { color: "#050913" },
      textColor: "#9eb1c9",
      fontFamily: '"IBM Plex Sans", "Helvetica Neue", "Segoe UI", sans-serif',
    },
    grid: {
      vertLines: { color: "rgba(84, 136, 220, 0.08)" },
      horzLines: { color: "rgba(84, 136, 220, 0.1)" },
    },
    timeScale: {
      borderColor: "rgba(84, 136, 220, 0.16)",
      timeVisible: true,
    },
    rightPriceScale: {
      borderColor: "rgba(84, 136, 220, 0.16)",
    },
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: "#0d8f54",
    downColor: "#c23a3a",
    wickUpColor: "#0d8f54",
    wickDownColor: "#c23a3a",
    borderVisible: false,
  });

  ema20LineSeries = chart.addLineSeries({
    color: "#67d5ff",
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });

  ema50LineSeries = chart.addLineSeries({
    color: "#7e9cff",
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });

  volumeSeries = chart.addHistogramSeries({
    priceFormat: { type: "volume" },
    priceScaleId: "",
    color: "rgba(84, 136, 220, 0.24)",
  });

  volumeSeries.priceScale().applyOptions({
    scaleMargins: {
      top: 0.82,
      bottom: 0,
    },
  });

  if (!chartResizeBound) {
    window.addEventListener("resize", resizeChart);
    chartResizeBound = true;
  }
}

function resizeChart() {
  if (!chart || !dom.chart) return;
  chart.applyOptions({
    width: dom.chart.clientWidth,
    height: dom.chart.clientHeight,
  });
}

function removePriceLines() {
  if (!candleSeries) return;
  priceLines.forEach((line) => candleSeries.removePriceLine(line));
  priceLines = [];
}

function addLevelLine(price, label, color) {
  if (!Number.isFinite(price)) return;
  const line = candleSeries.createPriceLine({
    price,
    color,
    lineWidth: 2,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    axisLabelVisible: true,
    title: label,
  });
  priceLines.push(line);
}

function hideChartSeriesLabels() {
  dom.chartLineLabelEma20.hidden = true;
  dom.chartLineLabelEma50.hidden = true;
}

function renderChartSeriesLabels(ema20Value, ema50Value, anchorTime) {
  if (!chart || !ema20LineSeries || !ema50LineSeries) {
    hideChartSeriesLabels();
    return;
  }

  window.requestAnimationFrame(() => {
    const latestTime = anchorTime ?? state.chartSnapshot?.candles?.[state.chartSnapshot.candles.length - 1]?.time ?? null;
    const chartWidth = dom.chart.clientWidth;
    const xCoordinate = Number.isFinite(latestTime) ? chart.timeScale().timeToCoordinate(latestTime) : null;
    const labelX = Number.isFinite(xCoordinate)
      ? Math.max(72, Math.min(chartWidth - 148, xCoordinate - 64))
      : Math.max(72, chartWidth - 180);

    const entries = [
      { element: dom.chartLineLabelEma20, series: ema20LineSeries, value: ema20Value },
      { element: dom.chartLineLabelEma50, series: ema50LineSeries, value: ema50Value },
    ];

    const active = entries
      .map((entry) => {
        const y = Number.isFinite(entry.value) ? entry.series.priceToCoordinate(entry.value) : null;
        if (!entry.element || !Number.isFinite(y)) {
          if (entry.element) entry.element.hidden = true;
          return null;
        }
        return { ...entry, y };
      })
      .filter(Boolean)
      .sort((left, right) => left.y - right.y);

    if (!active.length) {
      hideChartSeriesLabels();
      return;
    }

    const topPadding = 18;
    const bottomPadding = 10;
    const minGap = 18;
    const chartHeight = dom.chart.clientHeight;
    const positioned = [];

    active.forEach((entry, index) => {
      let y = Math.max(topPadding, Math.min(chartHeight - bottomPadding, entry.y - 12));
      if (index > 0 && y - positioned[index - 1].y < minGap) {
        y = positioned[index - 1].y + minGap;
      }
      positioned.push({ element: entry.element, y });
    });

    for (let index = positioned.length - 2; index >= 0; index -= 1) {
      const next = positioned[index + 1];
      if (next.y > chartHeight - bottomPadding) {
        positioned[index + 1].y = chartHeight - bottomPadding;
        positioned[index].y = Math.max(topPadding, positioned[index + 1].y - minGap);
      }
    }

    positioned.forEach((entry) => {
      entry.element.hidden = false;
      entry.element.style.left = `${labelX}px`;
      entry.element.style.top = `${entry.y}px`;
    });
  });
}

function renderChartHud(analysis) {
  dom.chartEma20.textContent = formatPrice(analysis.latestEma20, analysis.pricePrecision);
  dom.chartEma50.textContent = formatPrice(analysis.latestEma50, analysis.pricePrecision);
  dom.chartRsi.textContent = Number.isFinite(analysis.latestRsi) ? analysis.latestRsi.toFixed(1) : "-";
  dom.chartVolume.textContent = formatCompactNumber(analysis.latestVolume, 2);
  dom.chartEma20.className = toneFromNumber(analysis.currentPrice - analysis.latestEma20, 0.02);
  dom.chartEma50.className = toneFromNumber(analysis.currentPrice - analysis.latestEma50, 0.02);
  dom.chartRsi.className =
    analysis.latestRsi >= 50 && analysis.latestRsi <= 70 ? "up" : analysis.latestRsi < 45 ? "down" : "neutral";
  dom.chartVolume.className = "up";
}

function renderChart(analysis, snapshot) {
  candleSeries.setData(snapshot.candles);
  volumeSeries.setData(
    snapshot.candles.map((candle) => ({
      time: candle.time,
      value: candle.volume,
      color: volumeColor(candle),
    }))
  );
  ema20LineSeries.setData(analysis.ema20LineData);
  ema50LineSeries.setData(analysis.ema50LineData);
  candleSeries.setMarkers(analysis.markers || []);
  chart.timeScale().fitContent();
  removePriceLines();

  analysis.supportResistance.supportLevels.forEach((level, index) => {
    addLevelLine(level, `S${index + 1}`, "#0d8f54");
  });
  analysis.supportResistance.resistanceLevels.forEach((level, index) => {
    addLevelLine(level, `R${index + 1}`, "#c23a3a");
  });

  renderChartSeriesLabels(
    analysis.latestEma20,
    analysis.latestEma50,
    analysis.ema20LineData[analysis.ema20LineData.length - 1]?.time || snapshot.candles[snapshot.candles.length - 1]?.time
  );
  renderChartHud(analysis);
}

function renderSelectedAnalysis(analysis, snapshot) {
  state.chartAnalysis = analysis;
  state.chartSnapshot = snapshot;
  state.selectedSymbol = snapshot.symbol;
  state.selectedToken = snapshot.token;
  persistState();

  dom.tokenInput.value = snapshot.token;
  dom.assetTitle.textContent = `${snapshot.symbol} 1H Pullback`;
  dom.assetSubtitle.textContent = `EMA20/50 trend retest • ${analysis.historicalSignals.length} recent strategy markers`;
  dom.headlinePrice.textContent = formatPrice(analysis.currentPrice, analysis.pricePrecision);
  dom.headlineChange.textContent = formatPercent(analysis.change24h);
  dom.headlineChange.className = toneFromNumber(analysis.change24h, 0.08);
  dom.headlineBias.textContent = analysis.setupBias.label;
  dom.headlineBias.className = analysis.setupBias.tone;
  dom.metricSelected.textContent = snapshot.symbol;
  dom.metricSelectedNote.textContent = analysis.activeSignal
    ? `${analysis.activeSignal.touch} • ${analysis.activeSignal.side}`
    : analysis.setupBias.summary;

  const quality = qualityTier(analysis.qualityScore);
  dom.qualityBadge.textContent = `${analysis.qualityScore}`;
  dom.qualityBadge.className = analysis.activeSignal
    ? `score-badge ${analysis.setupBias.tone} ${quality.className}`
    : "score-badge neutral";
  setStreamStatus(
    analysis.activeSignal
      ? `${analysis.activeSignal.side} setup found on ${analysis.activeSignal.touch} retest`
      : "No fresh 1H EMA touch signal right now",
    analysis.activeSignal ? analysis.activeSignal.tone : "neutral"
  );

  const active = analysis.activeSignal;
  dom.summaryCopy.textContent = active
    ? `${snapshot.symbol} is showing a ${active.side.toLowerCase()} continuation setup after a ${active.touch} retest. Quality ${active.qualityScore} reflects trend stack, candle confirmation, liquidity, order flow, and room to target.`
    : `${snapshot.symbol} still shows ${analysis.setupBias.label.toLowerCase()} structure, but the latest candles have not produced a fresh EMA touch confirmation worth promoting.`;

  dom.stancePill.textContent = active ? active.side : "Waiting";
  dom.stancePill.className = `pill ${active ? active.tone : "neutral"}`;
  dom.entryZone.textContent = active
    ? `${formatPrice(active.entryLow, analysis.pricePrecision)} - ${formatPrice(active.entryHigh, analysis.pricePrecision)}`
    : "-";
  dom.stop.textContent = active ? formatPrice(active.stopLoss, analysis.pricePrecision) : "-";
  dom.tp1.textContent = active ? formatPrice(active.tp1, analysis.pricePrecision) : "-";
  dom.tp2.textContent = active ? formatPrice(active.tp2, analysis.pricePrecision) : "-";
  dom.planNote.textContent = active
    ? `${active.touch} retest • detected ${formatDateTime(active.detectedAt)} • ${active.sinceTouchBars} bars since touch`
    : "Need a fresh EMA20/50 retest with confirmation";
  dom.tradeSummary.textContent = active
    ? `${active.note} Entry zone stays around the EMA stack. Initial invalidation sits beyond the touch candle plus ATR buffer.`
    : "Tradez is waiting for a fresh trend pullback that tags EMA20 or EMA50 and confirms with candle structure.";

  renderSignalList(buildSignalCards(analysis));
  renderLevelBands(
    dom.supportFields,
    analysis.supportResistance.supportLevels,
    analysis.supportResistance.bandWidth,
    "up",
    analysis.pricePrecision
  );
  renderLevelBands(
    dom.resistanceFields,
    analysis.supportResistance.resistanceLevels,
    analysis.supportResistance.bandWidth,
    "down",
    analysis.pricePrecision
  );
  renderChart(analysis, snapshot);
}

function renderEmptySelected(message) {
  dom.assetTitle.textContent = "Tradez chart";
  dom.assetSubtitle.textContent = message;
  dom.headlinePrice.textContent = "-";
  dom.headlineChange.textContent = "-";
  dom.headlineBias.textContent = "-";
  dom.qualityBadge.textContent = "0";
  dom.qualityBadge.className = "score-badge neutral";
  dom.summaryCopy.textContent = message;
  dom.stancePill.textContent = "Waiting";
  dom.stancePill.className = "pill neutral";
  dom.entryZone.textContent = "-";
  dom.stop.textContent = "-";
  dom.tp1.textContent = "-";
  dom.tp2.textContent = "-";
  dom.tradeSummary.textContent = "No Tradez setup yet.";
  renderSignalList([
    {
      label: "Status",
      value: "Waiting",
      note: message,
      tone: "neutral",
    },
  ]);
  renderLevelBands(dom.supportFields, [], 0, "neutral", 2);
  renderLevelBands(dom.resistanceFields, [], 0, "neutral", 2);
  candleSeries.setData([]);
  volumeSeries.setData([]);
  ema20LineSeries.setData([]);
  ema50LineSeries.setData([]);
  candleSeries.setMarkers([]);
  removePriceLines();
  hideChartSeriesLabels();
  dom.chartEma20.textContent = "-";
  dom.chartEma50.textContent = "-";
  dom.chartRsi.textContent = "-";
  dom.chartVolume.textContent = "-";
}

function renderMonitorTable(container, headers, rows, emptyText) {
  if (!rows.length) {
    container.innerHTML = `
      <div class="monitor-empty">
        ${emptyText}
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="monitor-table-shell">
      <table>
        <thead>
          <tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows.join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderSignalFeed() {
  const qualified = state.candidates.filter((candidate) => candidate.activeSignal && candidate.qualityScore >= state.qualityThreshold);

  const rows = qualified.map((candidate) => {
    const quality = qualityTier(candidate.qualityScore);
    const signal = candidate.activeSignal;
    return `
      <tr>
        <td class="monitor-symbol">
          <button class="mini-button tradez-symbol-button" type="button" data-symbol="${candidate.symbol}">
            ${candidate.symbol}
          </button>
          <div class="monitor-subtle">${volumeTier(universeTickerMap.get(candidate.symbol)?.quoteVolume || 0).label}</div>
        </td>
        <td>${formatDateTime(signal.detectedAt)}</td>
        <td><span class="${signal.tone}">${signal.side}</span></td>
        <td>${signal.touch}</td>
        <td>${formatPrice(candidate.currentPrice, candidate.pricePrecision)}</td>
        <td>${formatPrice(signal.entryLow, candidate.pricePrecision)} - ${formatPrice(signal.entryHigh, candidate.pricePrecision)}</td>
        <td>${formatPrice(signal.stopLoss, candidate.pricePrecision)}</td>
        <td>${formatPrice(signal.tp1, candidate.pricePrecision)} / ${formatPrice(signal.tp2, candidate.pricePrecision)}</td>
        <td>${signal.reasonParts.slice(0, 3).join(" • ")}</td>
        <td class="quality-column quality-column-centered">
          <span class="quality-chip ${quality.className}" title="${quality.label}">
            Q${candidate.qualityScore}
          </span>
        </td>
      </tr>
    `;
  });

  renderMonitorTable(
    dom.signalTable,
    [
      "Pair",
      "Detected",
      "Setup",
      "Touch",
      "Price",
      "Entry Zone",
      "Stop",
      "Targets",
      "Why It Qualifies",
      '<span class="quality-column-heading">Quality</span>',
    ],
    rows,
    "No EMA20/50 pullback setup currently clears the active quality threshold."
  );

  dom.signalTable.querySelectorAll("[data-symbol]").forEach((button) => {
    button.addEventListener("click", async () => {
      const symbol = button.getAttribute("data-symbol");
      if (!symbol) return;
      await loadSelectedToken(symbol);
    });
  });
}

function renderAlertFeed() {
  if (!state.alertEvents.length) {
    dom.alertTable.innerHTML = `
      <div class="table-row">
        <div>
          <span>Status</span>
          <strong>No alerts yet</strong>
        </div>
        <div>
          <span>Trigger</span>
          <strong>Waiting</strong>
        </div>
        <div>
          <span>Note</span>
          <strong>Tradez will log new qualified EMA pullbacks here.</strong>
        </div>
      </div>
    `;
    return;
  }

  dom.alertTable.innerHTML = state.alertEvents
    .slice(0, 16)
    .map(
      (event) => `
        <div class="table-row">
          <div>
            <span>${formatDateTime(event.detectedAt)}</span>
            <strong class="${event.tone}">${event.symbol} • ${event.side} • Q${event.qualityScore}</strong>
          </div>
          <div>
            <span>Touch</span>
            <strong>${event.touch}</strong>
          </div>
          <div>
            <span>Plan</span>
            <strong>${event.plan}</strong>
          </div>
        </div>
      `
    )
    .join("");
}

function renderStrategyNotes() {
  renderAnalysisGrid(dom.notesGrid, [
    {
      label: "What qualifies",
      value: "Trend + touch + confirmation",
      note: "EMA20 above EMA50 for longs, below for shorts. Tradez only promotes pullbacks that tag the stack and then confirm with candle structure.",
      tone: "up",
    },
    {
      label: "Prefer",
      value: "First or second retest",
      note: "Fresh pullbacks usually behave better than the fourth or fifth touch. Older touches lose edge as the move matures.",
      tone: "neutral",
    },
    {
      label: "Avoid",
      value: "No room into levels",
      note: "If resistance is too close for longs, or support is too close for shorts, the move is often statistically clean but structurally cramped.",
      tone: "down",
    },
    {
      label: "Best filter",
      value: "Volume + flow confirmation",
      note: "Touches work better when volume expands, CVD agrees, and taker flow is moving in the same direction as the trend stack.",
      tone: "up",
    },
  ]);
}

function updateTabs() {
  const tabs = [
    { key: "signals", button: dom.tabSignals, panel: dom.panelSignals, note: "Signal Feed shows the highest-quality live EMA pullback opportunities across the scanned universe." },
    { key: "alerts", button: dom.tabAlerts, panel: dom.panelAlerts, note: "Alert Events logs newly detected qualifying setups as the engine rotates through the universe." },
    { key: "notes", button: dom.tabNotes, panel: dom.panelNotes, note: "Strategy Notes keeps the pattern disciplined so we do not treat every EMA touch as an entry." },
  ];

  tabs.forEach((tab) => {
    tab.button.classList.toggle("is-active", state.activeTab === tab.key);
    tab.panel.hidden = state.activeTab !== tab.key;
    if (state.activeTab === tab.key) dom.tabNote.textContent = tab.note;
  });
}

function pushAlertEvent(candidate) {
  const signal = candidate.activeSignal;
  if (!signal || signal.qualityScore < state.qualityThreshold) return;
  if (state.seenSignalIds.has(signal.id)) return;

  state.seenSignalIds.add(signal.id);
  state.alertEvents.unshift({
    id: signal.id,
    detectedAt: signal.detectedAt,
    symbol: candidate.symbol,
    side: signal.side,
    tone: signal.tone,
    touch: signal.touch,
    qualityScore: signal.qualityScore,
    plan: `${formatPrice(signal.entryLow, candidate.pricePrecision)} - ${formatPrice(signal.entryHigh, candidate.pricePrecision)} • TP ${formatPrice(signal.tp1, candidate.pricePrecision)}`,
  });
  state.alertEvents = state.alertEvents.slice(0, 36);
  persistState();
  renderAlertFeed();

  if (state.alertPermission === "granted" && typeof Notification !== "undefined") {
    const notification = new Notification(`${candidate.symbol} ${signal.side} pullback`, {
      body: `${signal.touch} retest qualified at Q${signal.qualityScore}. Entry ${formatPrice(signal.entryLow, candidate.pricePrecision)} - ${formatPrice(signal.entryHigh, candidate.pricePrecision)}.`,
    });
    window.setTimeout(() => notification.close(), 7000);
  }
}

function updateMetrics() {
  const qualified = state.candidates.filter((candidate) => candidate.activeSignal && candidate.qualityScore >= state.qualityThreshold);
  const bullish = qualified.filter((candidate) => candidate.activeSignal.side === "Long").length;
  const bearish = qualified.filter((candidate) => candidate.activeSignal.side === "Short").length;

  dom.metricQualified.textContent = `${qualified.length}`;
  dom.metricQualifiedNote.textContent = `Quality >= ${state.qualityThreshold} on 1H pullbacks`;
  dom.metricBullish.textContent = `${bullish}`;
  dom.metricBullishNote.textContent = bullish ? "Long EMA pullbacks active" : "No long pullbacks qualified";
  dom.metricBearish.textContent = `${bearish}`;
  dom.metricBearishNote.textContent = bearish ? "Short EMA pullbacks active" : "No short pullbacks qualified";
  dom.metricAlerts.textContent = `${state.alertEvents.length}`;
  dom.metricAlertsNote.textContent = state.alertEvents.length ? "Stored alert events on this browser" : "No alert events stored yet";
  dom.metricLastScan.textContent = formatClock(state.lastScanAt);
  dom.metricLastScanNote.textContent = state.lastScanAt ? "Universe rotated every 5m" : "First scan pending";
  dom.autoNote.textContent = `Universe scan refreshes every 5 minutes. ${qualified.length} qualified right now.`;
}

function updateAlertPermissionButton() {
  const status = state.alertPermission;
  if (status === "granted") dom.alertPermissionButton.textContent = "Browser Alerts Enabled";
  else if (status === "denied") dom.alertPermissionButton.textContent = "Browser Alerts Blocked";
  else if (status === "unsupported") dom.alertPermissionButton.textContent = "Alerts Unsupported";
  else dom.alertPermissionButton.textContent = "Enable Browser Alerts";
  dom.alertPermissionButton.disabled = status === "unsupported" || status === "denied";
}

async function requestAlertPermission() {
  if (typeof Notification === "undefined") {
    state.alertPermission = "unsupported";
    updateAlertPermissionButton();
    return;
  }
  state.alertPermission = await Notification.requestPermission();
  updateAlertPermissionButton();
}

async function loadSelectedToken(tokenOrSymbol) {
  const normalized = normalizeToken(tokenOrSymbol);
  setStatus(`Loading ${normalized} into Tradez...`, "neutral");

  try {
    const snapshot = await fetchEngineSnapshot(tokenOrSymbol);
    const analysis = buildTradezSignals(snapshot, universeTickerMap.get(snapshot.symbol)?.quoteVolume || Number(snapshot.ticker?.quoteVolume) || 0);
    renderSelectedAnalysis(analysis, snapshot);
    setStatus(`${snapshot.symbol} loaded into Tradez.`, "up");
  } catch (error) {
    console.error(error);
    renderEmptySelected(error.message || "Unable to load the selected Tradez chart.");
    setStatus(error.message || "Tradez chart failed to load.", "down");
  }
}

async function scanUniverse(manual = false) {
  setStatus(
    manual
      ? "Running manual Tradez universe scan..."
      : "Scanning Binance perps for 1H EMA20/50 pullback setups...",
    "neutral"
  );

  try {
    const universe = await getPerpUniverse();
    const tickers = await fetchUniverseTickers();
    universeTickerMap = buildTickerLookup(tickers);
    const batch = selectUniverseBatch(universe);

    const analyses = await mapWithConcurrency(batch, ANALYSIS_CONCURRENCY, async (symbolInfo) => {
      try {
        const snapshot = await fetchEngineSnapshot(symbolInfo.symbol);
        const ticker = universeTickerMap.get(symbolInfo.symbol) || {};
        const analysis = buildTradezSignals(snapshot, ticker.quoteVolume || Number(snapshot.ticker?.quoteVolume) || 0);
        return {
          ...analysis,
          snapshot,
        };
      } catch (error) {
        return null;
      }
    });

    latestBatchMap = new Map(analyses.filter(Boolean).map((candidate) => [candidate.symbol, candidate]));

    state.candidates = analyses
      .filter(Boolean)
      .filter((candidate) => candidate.activeSignal && candidate.activeSignal.sinceTouchBars <= 3)
      .sort((left, right) => right.qualityScore - left.qualityScore)
      .slice(0, 28);

    candidateMap = new Map(state.candidates.map((candidate) => [candidate.symbol, candidate]));
    state.lastScanAt = Date.now();
    persistState();

    state.candidates.forEach(pushAlertEvent);
    renderSignalFeed();
    renderAlertFeed();
    updateMetrics();

    const best = state.candidates[0];
    if (best) {
      setStatus(
        `${state.candidates.filter((candidate) => candidate.qualityScore >= state.qualityThreshold).length} Tradez setups qualified. ${best.symbol} leads with Q${best.qualityScore}.`,
        "up"
      );
    } else {
      setStatus("Tradez scan complete. No setup currently clears the active quality filter.", "neutral");
    }

    const selectedCandidate = state.selectedSymbol ? latestBatchMap.get(state.selectedSymbol) : null;
    if (selectedCandidate) {
      renderSelectedAnalysis(selectedCandidate, selectedCandidate.snapshot);
    } else if (!state.chartSnapshot && best) {
      renderSelectedAnalysis(best, best.snapshot);
    } else if (!state.chartSnapshot) {
      await loadSelectedToken(state.selectedToken);
    }
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Tradez scan failed.", "down");
    if (!state.chartSnapshot) renderEmptySelected(error.message || "Tradez is waiting for data.");
  }
}

function startAutoScan() {
  if (scanTimer) window.clearInterval(scanTimer);
  scanTimer = window.setInterval(() => {
    scanUniverse(false);
  }, AUTO_SCAN_MS);
}

function bindEvents() {
  dom.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.selectedToken = normalizeToken(dom.tokenInput.value);
    state.qualityThreshold = Math.max(50, Number(dom.qualityThreshold.value) || DEFAULT_QUALITY_THRESHOLD);
    persistState();
    await loadSelectedToken(state.selectedToken);
    await scanUniverse(true);
  });

  dom.scanButton.addEventListener("click", () => {
    state.qualityThreshold = Math.max(50, Number(dom.qualityThreshold.value) || DEFAULT_QUALITY_THRESHOLD);
    persistState();
    scanUniverse(true);
  });

  dom.alertPermissionButton.addEventListener("click", requestAlertPermission);
  dom.tabSignals.addEventListener("click", () => {
    state.activeTab = "signals";
    persistState();
    updateTabs();
  });
  dom.tabAlerts.addEventListener("click", () => {
    state.activeTab = "alerts";
    persistState();
    updateTabs();
  });
  dom.tabNotes.addEventListener("click", () => {
    state.activeTab = "notes";
    persistState();
    updateTabs();
  });
}

async function init() {
  dom.tokenInput.value = state.selectedToken;
  dom.qualityThreshold.value = `${state.qualityThreshold}`;
  updateAlertPermissionButton();
  updateTabs();
  renderStrategyNotes();
  renderAlertFeed();
  initChart();
  bindEvents();
  updateMetrics();
  await loadSelectedToken(state.selectedToken);
  await scanUniverse(false);
  startAutoScan();
}

init();
