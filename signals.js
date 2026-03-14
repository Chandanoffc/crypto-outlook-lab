const DEFAULT_TOKEN = "BTC";
const QUOTE_ASSET = "USDT";
const STRATEGY_INTERVAL = "1h";
const DEFAULT_QUALITY_THRESHOLD = 78;
const DEFAULT_WATCHLIST = ["BTC", "ETH", "SOL", "XRP", "DOGE"];
const AUTO_SCAN_MS = 5 * 60 * 1000;
const ANALYSIS_CONCURRENCY = 4;
const PRIORITY_SCAN_COUNT = 14;
const ROTATION_SCAN_COUNT = 32;
const FULL_SCAN_MAX_SYMBOLS = 180;
const EXPERIMENTAL_STRATEGY_SPECS = [
  { id: "liq", label: "Liq Magnet", shortLabel: "Liq", tone: "neutral", maxOpenTrades: 1 },
  { id: "obfvg", label: "OB + FVG", shortLabel: "OB/FVG", tone: "up", maxOpenTrades: 1 },
  { id: "funding", label: "Funding MR", shortLabel: "Funding", tone: "down", maxOpenTrades: 1 },
];
const EXPERIMENTAL_START_BALANCE = 100;
const EXPERIMENTAL_MAX_NEW_TRADES_PER_SCAN = EXPERIMENTAL_STRATEGY_SPECS.length;
const EXPERIMENTAL_MAX_CONCURRENT_TRADES = EXPERIMENTAL_STRATEGY_SPECS.reduce(
  (sum, spec) => sum + spec.maxOpenTrades,
  0
);
const EXPERIMENTAL_MIN_RR = 1.3;
const EXPERIMENTAL_TRADE_COOLDOWN_MS = 4 * 60 * 1000;
const EXPERIMENTAL_STRATEGY_VERSION = 1;
const TICKER_STORAGE_KEY = "apex-signals-my-signals-tickers";
const TICKER_CACHE_MAX_AGE_MS = 30 * 60 * 1000;
const STORAGE_KEY = "apex-signals-my-signals-state";

const dom = {
  form: document.getElementById("signals-form"),
  tokenInput: document.getElementById("signals-token-input"),
  watchlistInput: document.getElementById("signals-watchlist-input"),
  qualityThreshold: document.getElementById("signals-quality-threshold"),
  refreshSubmit: document.getElementById("signals-refresh-submit"),
  pinCurrentButton: document.getElementById("signals-pin-current"),
  browserAlertsButton: document.getElementById("signals-browser-alerts"),
  clearPinsButton: document.getElementById("signals-clear-pins"),
  autoNote: document.getElementById("signals-auto-note"),
  statusBanner: document.getElementById("signals-status-banner"),
  metricWatchlist: document.getElementById("signals-metric-watchlist"),
  metricWatchlistNote: document.getElementById("signals-metric-watchlist-note"),
  metricQualified: document.getElementById("signals-metric-qualified"),
  metricQualifiedNote: document.getElementById("signals-metric-qualified-note"),
  metricPinned: document.getElementById("signals-metric-pinned"),
  metricPinnedNote: document.getElementById("signals-metric-pinned-note"),
  metricLongs: document.getElementById("signals-metric-longs"),
  metricLongsNote: document.getElementById("signals-metric-longs-note"),
  metricShorts: document.getElementById("signals-metric-shorts"),
  metricShortsNote: document.getElementById("signals-metric-shorts-note"),
  metricLastScan: document.getElementById("signals-metric-last-scan"),
  metricLastScanNote: document.getElementById("signals-metric-last-scan-note"),
  assetTitle: document.getElementById("signals-asset-title"),
  assetSubtitle: document.getElementById("signals-asset-subtitle"),
  headlinePrice: document.getElementById("signals-headline-price"),
  headlineChange: document.getElementById("signals-headline-change"),
  headlineBias: document.getElementById("signals-headline-bias"),
  chart: document.getElementById("signals-chart"),
  chartEma20: document.getElementById("signals-chart-ema20"),
  chartEma50: document.getElementById("signals-chart-ema50"),
  chartRsi: document.getElementById("signals-chart-rsi"),
  chartVolume: document.getElementById("signals-chart-volume"),
  chartLineLabelEma20: document.getElementById("signals-chart-line-label-ema20"),
  chartLineLabelEma50: document.getElementById("signals-chart-line-label-ema50"),
  supportFields: document.getElementById("signals-support-fields"),
  resistanceFields: document.getElementById("signals-resistance-fields"),
  qualityBadge: document.getElementById("signals-quality-badge"),
  qualityMeter: document.getElementById("signals-quality-meter"),
  qualityLabel: document.getElementById("signals-quality-label"),
  streamStatus: document.getElementById("signals-stream-status"),
  sideTabSelected: document.getElementById("signals-side-tab-selected"),
  sideTabQuality: document.getElementById("signals-side-tab-quality"),
  sideTabPrime: document.getElementById("signals-side-tab-prime"),
  sideNote: document.getElementById("signals-side-note"),
  sidePanelSelected: document.getElementById("signals-side-panel-selected"),
  sidePanelQuality: document.getElementById("signals-side-panel-quality"),
  sidePanelPrime: document.getElementById("signals-side-panel-prime"),
  qualityFeed: document.getElementById("signals-quality-feed"),
  primeFeed: document.getElementById("signals-prime-feed"),
  summaryCopy: document.getElementById("signals-summary-copy"),
  stancePill: document.getElementById("signals-stance-pill"),
  entryZone: document.getElementById("signals-entry-zone"),
  stop: document.getElementById("signals-stop"),
  tp1: document.getElementById("signals-tp1"),
  tp2: document.getElementById("signals-tp2"),
  tradeSummary: document.getElementById("signals-trade-summary"),
  planNote: document.getElementById("signals-plan-note"),
  signalList: document.getElementById("signals-signal-list"),
  tabLive: document.getElementById("signals-tab-live"),
  tabPinned: document.getElementById("signals-tab-pinned"),
  tabNotes: document.getElementById("signals-tab-notes"),
  tabNote: document.getElementById("signals-tab-note"),
  panelLive: document.getElementById("signals-panel-live"),
  panelPinned: document.getElementById("signals-panel-pinned"),
  panelNotes: document.getElementById("signals-panel-notes"),
  liveTable: document.getElementById("signals-live-table"),
  pinnedTable: document.getElementById("signals-pinned-table"),
  notesGrid: document.getElementById("signals-notes-grid"),
  strategyTabPositions: document.getElementById("signals-strategy-tab-positions"),
  strategyTabTrades: document.getElementById("signals-strategy-tab-trades"),
  strategyTabActivity: document.getElementById("signals-strategy-tab-activity"),
  strategyTabNote: document.getElementById("signals-strategy-tab-note"),
  strategySleeveGrid: document.getElementById("signals-strategy-sleeve-grid"),
  strategyPanelPositions: document.getElementById("signals-strategy-panel-positions"),
  strategyPanelTrades: document.getElementById("signals-strategy-panel-trades"),
  strategyPanelActivity: document.getElementById("signals-strategy-panel-activity"),
  strategyOpenGrid: document.getElementById("signals-strategy-open-grid"),
  strategyTradeLog: document.getElementById("signals-strategy-trade-log"),
  strategyActivityTable: document.getElementById("signals-strategy-activity-table"),
};

const state = loadState();

let chart;
let candleSeries;
let volumeSeries;
let ema20LineSeries;
let ema50LineSeries;
let priceLines = [];
let chartResizeBound = false;
let exchangeInfoCache = null;
let perpUniverseCache = null;
let scanTimer = null;
let lastSignalMap = new Map();
let universeTickerMap = new Map();
let universeSignalMap = new Map();
let scanCursor = 0;
let flashTimer = null;

function buildDefaultExperimentalBalances() {
  return EXPERIMENTAL_STRATEGY_SPECS.reduce((accumulator, spec) => {
    accumulator[spec.id] = EXPERIMENTAL_START_BALANCE;
    return accumulator;
  }, {});
}

function normalizeExperimentalBalances(storedBalances = {}) {
  const balances = buildDefaultExperimentalBalances();
  EXPERIMENTAL_STRATEGY_SPECS.forEach((spec) => {
    const value = Number(storedBalances?.[spec.id]);
    if (Number.isFinite(value)) balances[spec.id] = value;
  });
  return balances;
}

function experimentalStrategySpec(strategyId) {
  return (
    EXPERIMENTAL_STRATEGY_SPECS.find((spec) => spec.id === strategyId) || EXPERIMENTAL_STRATEGY_SPECS[0]
  );
}

function applyExperimentalStrategyUpgrade() {
  if (state.experimentalStrategyVersion >= EXPERIMENTAL_STRATEGY_VERSION) return;
  state.strategyBalances = buildDefaultExperimentalBalances();
  state.strategyOpenTrades = [];
  state.strategyClosedTrades = [];
  state.strategyActivity = [];
  state.experimentalCandidates = [];
  state.seenExperimentalSignalIds = new Set();
  state.experimentalStrategyVersion = EXPERIMENTAL_STRATEGY_VERSION;
  persistState();
}

function loadState() {
  const stored = readStoredJson(STORAGE_KEY, {});
  return {
    selectedToken: stored.selectedToken || DEFAULT_TOKEN,
    selectedSymbol: stored.selectedSymbol || null,
    watchlist: Array.isArray(stored.watchlist) && stored.watchlist.length ? stored.watchlist : DEFAULT_WATCHLIST,
    qualityThreshold: Number(stored.qualityThreshold) || DEFAULT_QUALITY_THRESHOLD,
    activeTab: stored.activeTab || "live",
    sideTab: stored.sideTab || "selected",
    lastScanAt: Number(stored.lastScanAt) || 0,
    pinnedSignals: Array.isArray(stored.pinnedSignals) ? stored.pinnedSignals : [],
    seenSignalIds: new Set(Array.isArray(stored.seenSignalIds) ? stored.seenSignalIds : []),
    alertPermission: typeof Notification === "undefined" ? "unsupported" : Notification.permission,
    primeSignals: Array.isArray(stored.primeSignals) ? stored.primeSignals : [],
    liveSignals: [],
    selectedAnalysis: null,
    selectedSnapshot: null,
    strategyTab: stored.strategyTab || "positions",
    experimentalStrategyVersion: Number(stored.experimentalStrategyVersion) || 0,
    strategyBalances: normalizeExperimentalBalances(stored.strategyBalances),
    strategyOpenTrades: Array.isArray(stored.strategyOpenTrades)
      ? stored.strategyOpenTrades.map((trade) => ({
          ...trade,
          strategyLabel: trade.strategyLabel || experimentalStrategySpec(trade.strategyId).label,
        }))
      : [],
    strategyClosedTrades: Array.isArray(stored.strategyClosedTrades)
      ? stored.strategyClosedTrades.map((trade) => ({
          ...trade,
          strategyLabel: trade.strategyLabel || experimentalStrategySpec(trade.strategyId).label,
        }))
      : [],
    strategyActivity: Array.isArray(stored.strategyActivity) ? stored.strategyActivity : [],
    experimentalCandidates: [],
    seenExperimentalSignalIds: new Set(
      Array.isArray(stored.seenExperimentalSignalIds) ? stored.seenExperimentalSignalIds : []
    ),
  };
}

function persistState() {
  writeStoredJson(STORAGE_KEY, {
    selectedToken: state.selectedToken,
    selectedSymbol: state.selectedSymbol,
    watchlist: state.watchlist,
    qualityThreshold: state.qualityThreshold,
    activeTab: state.activeTab,
    sideTab: state.sideTab,
    lastScanAt: state.lastScanAt,
    pinnedSignals: state.pinnedSignals.slice(0, 32),
    seenSignalIds: Array.from(state.seenSignalIds).slice(-200),
    primeSignals: state.primeSignals.slice(0, 24),
    strategyTab: state.strategyTab,
    experimentalStrategyVersion: state.experimentalStrategyVersion,
    strategyBalances: state.strategyBalances,
    strategyOpenTrades: state.strategyOpenTrades,
    strategyClosedTrades: state.strategyClosedTrades.slice(0, 120),
    strategyActivity: state.strategyActivity.slice(0, 80),
    seenExperimentalSignalIds: Array.from(state.seenExperimentalSignalIds).slice(-200),
  });
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
    // Ignore storage failures.
  }
}

function getFallbackExchangeInfo() {
  const fallback = window.APEX_FALLBACK_PERPS;
  if (!fallback || !Array.isArray(fallback.symbols) || !fallback.symbols.length) return null;
  return fallback;
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

function parseWatchlist(value) {
  const tokens = String(value || "")
    .split(/[,\s]+/)
    .map((item) => normalizeToken(item))
    .filter(Boolean);
  return Array.from(new Set(tokens)).slice(0, 18);
}

function setStatus(message, tone = "neutral") {
  dom.statusBanner.textContent = message;
  dom.statusBanner.className = `status-banner ${tone}`;
}

function setStreamStatus(message, tone = "neutral") {
  dom.streamStatus.textContent = message;
  dom.streamStatus.className = `stream-status ${tone}`;
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

function setQualityMeter(score) {
  if (!dom.qualityMeter || !dom.qualityLabel) return;
  const progress = Math.max(6, Math.min(100, Math.round((Math.max(0, score) / 200) * 100)));
  dom.qualityMeter.style.setProperty("--quality-progress", `${progress}%`);
  dom.qualityLabel.textContent = score > 0 ? qualityTier(score).label : "Monitoring";
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

function renderMonitorTable(container, headers, rows, emptyText) {
  if (!container) return;
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

  if (!response.ok) throw new Error(`${label} failed (${response.status})`);
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

function buildTickerLookup(tickers) {
  return new Map((tickers || []).map((ticker) => [ticker.symbol, ticker]));
}

function selectUniverseBatch(universe) {
  if (universe.length <= FULL_SCAN_MAX_SYMBOLS) {
    return [...universe];
  }

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
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function volumeTier(quoteVolume) {
  if (quoteVolume >= 750_000_000) return { label: "High Volume", tone: "up" };
  if (quoteVolume >= 100_000_000) return { label: "Mid Cap Volume", tone: "neutral" };
  return { label: "Low Cap Volume", tone: "down" };
}

function hasGoodTradingVolume(quoteVolume) {
  return Number(quoteVolume) >= 50_000_000;
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

function buildPullbackSignals(snapshot) {
  const candles = (snapshot.candles || []).map((candle) => ({ ...candle }));
  const closes = candles.map((candle) => candle.close);
  const currentPrice =
    Number(snapshot.premiumIndex?.markPrice) || Number(snapshot.ticker?.lastPrice) || closes[closes.length - 1] || 0;
  const ema20Series = ema(closes, 20);
  const ema50Series = ema(closes, 50);
  const rsiSeries = rsi(closes, 14);
  const atrSeries = atr(candles, 14);
  const bollingerSeries = bollingerBands(closes, 20, 2);
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
  const quoteVolume = Number(snapshot.ticker?.quoteVolume) || 0;
  const bias = buildSetupBias(currentPrice, latestEma20, latestEma50, latestRsi);
  const directionalBias =
    latestEma20 > latestEma50
      ? { label: "Bullish", tone: "up" }
      : latestEma20 < latestEma50
        ? { label: "Bearish", tone: "down" }
        : { label: "Balanced", tone: "neutral" };
  const historicalSignals = [];
  const markers = [];
  let activeSignal = null;

  const startIndex = Math.max(55, candles.length - 12);

  for (let index = startIndex; index < candles.length - 1; index += 1) {
    const candle = candles[index];
    const nextCandle = candles[index + 1];
    const ema20Value = ema20Series[index];
    const ema50Value = ema50Series[index];
    const atrValue = atrSeries[index] ?? latestAtr;
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
      note:
        side === "Long"
          ? `${touchLabel(touch20, touch50)} retest held while EMA20 stays above EMA50.`
          : `${touchLabel(touch20, touch50)} retest failed while EMA20 stays below EMA50.`,
      reasonParts: [
        hasGoodTradingVolume(quoteVolume) ? "good liquidity" : "thin liquidity",
        volumeFactor >= 1 ? "volume confirmed" : "volume soft",
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

  let entryQualityScore = 0;
  if (hasGoodTradingVolume(quoteVolume)) entryQualityScore += 10;
  else entryQualityScore -= 10;

  if (directionalBias.tone === "up") {
    entryQualityScore += latestRsi >= 50 && latestRsi <= 68 ? 8 : -8;
    entryQualityScore += tradeSummary.cvdSlope > 0 ? 8 : -8;
    entryQualityScore += takerSummary.latestRatio > 1.01 ? 6 : -6;
    entryQualityScore += depthSummary.imbalance > 0.02 ? 5 : -5;
    entryQualityScore += oiChange1h > 0 ? 5 : -3;
    if (fundingRate > 0.03) entryQualityScore -= 6;
  } else if (directionalBias.tone === "down") {
    entryQualityScore += latestRsi <= 50 && latestRsi >= 32 ? 8 : -8;
    entryQualityScore += tradeSummary.cvdSlope < 0 ? 8 : -8;
    entryQualityScore += takerSummary.latestRatio < 0.99 ? 6 : -6;
    entryQualityScore += depthSummary.imbalance < -0.02 ? 5 : -5;
    entryQualityScore += oiChange1h > 0 ? 5 : -3;
    if (fundingRate < -0.03) entryQualityScore -= 6;
  }

  const entryReference = activeSignal ? average([activeSignal.entryLow, activeSignal.entryHigh]) : currentPrice;
  const trade =
    activeSignal
      ? {
          stance: activeSignal.side,
          tone: activeSignal.tone,
          entry: entryReference,
          stopLoss: activeSignal.stopLoss,
          takeProfit: activeSignal.tp1,
          targetReturnPct: Math.abs(pctChange(entryReference, activeSignal.tp1)) * 5,
          stopReturnPct: Math.abs(pctChange(entryReference, activeSignal.stopLoss)) * 5,
          projectedMovePct: Math.abs(pctChange(entryReference, activeSignal.tp1)),
          leverage: 5,
        }
      : null;

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
    candles,
    quoteVolume,
    rsi: latestRsi,
    ema20: latestEma20,
    ema50: latestEma50,
    rsiSeries,
    bollingerSeries,
    bias: directionalBias,
    entryQualityScore,
    trade,
    rr: activeSignal?.rr ?? 0,
    recentPriceChange: pctChangeFromLookback(closes, 6),
    supportResistance,
    tradeSummary,
    cvdSlope: tradeSummary.cvdSlope,
    depthSummary,
    depthImbalance: depthSummary.imbalance,
    takerSummary,
    takerRatio: takerSummary.latestRatio,
    oiChange1h,
    fundingRate,
    ema20LineData: candles
      .map((candle, index) => (ema20Series[index] == null ? null : { time: candle.time, value: ema20Series[index] }))
      .filter(Boolean),
    ema50LineData: candles
      .map((candle, index) => (ema50Series[index] == null ? null : { time: candle.time, value: ema50Series[index] }))
      .filter(Boolean),
    setupBias,
    markers: markers.slice(-12),
    historicalSignals: historicalSignals.slice(-10),
    activeSignal,
    qualityScore: activeSignal?.qualityScore ?? 0,
    snapshot,
  };
}

function buildSelectedSignalCards(candidate) {
  const active = candidate?.activeSignal;
  if (!active) {
    return [
      {
        label: "Status",
        value: "No fresh setup",
        note: "The selected token is not offering a clean EMA20/50 continuation entry right now.",
        tone: "neutral",
      },
      {
        label: "Trend stack",
        value: candidate?.setupBias?.label || "Balanced",
        note: candidate?.setupBias?.summary || "Trend structure is mixed.",
        tone: candidate?.setupBias?.tone || "neutral",
      },
    ];
  }

  return [
    {
      label: "Touch zone",
      value: active.touch,
      note: `${formatDateTime(active.detectedAt)} • ${active.sinceTouchBars} bars since touch • ${active.reasonParts[0]}`,
      tone: active.tone,
    },
    {
      label: "Flow read",
      value: active.tone === "up" ? "Buyers leading" : "Sellers leading",
      note: `${active.reasonParts[2]} • ${active.reasonParts[3]}`,
      tone: active.tone,
    },
    {
      label: "Reward to risk",
      value: `${active.rr.toFixed(2)}R`,
      note: `${formatPrice(active.entryLow, candidate.pricePrecision)} - ${formatPrice(active.entryHigh, candidate.pricePrecision)}`,
      tone: active.rr >= 1.5 ? "up" : "neutral",
    },
  ];
}

function buildExperimentalStrategySignal({
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
    strategyLabel: experimentalStrategySpec(strategyId).label,
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
  qualityScore += Math.round((longValid ? lowerWickRatio(sweepCandle) : upperWickRatio(sweepCandle)) * 24);
  qualityScore += Math.max(0, Math.round((Math.max(sweepCandle.volume / avgVolume, 1) - 1) * 14));
  qualityScore += side === "Long" ? (candidate.rsi <= 42 ? 8 : 0) : candidate.rsi >= 58 ? 8 : 0;
  qualityScore += side === "Long" ? (candidate.fundingRate > 0 ? 4 : 0) : candidate.fundingRate < 0 ? 4 : 0;
  qualityScore += candidate.oiChange1h < 0 ? 4 : 0;

  return buildExperimentalStrategySignal({
    strategyId: "liq",
    side,
    tone,
    qualityScore,
    detectedAt: sweepCandle.time * 1000,
    entry,
    stopLoss,
    takeProfit,
    leverage: 8,
    note: "Proxy liquidation sweep: wick, RSI divergence, and reclaim near clustered liquidity.",
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
      if (retest.low <= gapHigh && retest.high >= gapLow) retestIndex = cursor;
    }
    if (retestIndex === -1 || candles.length - 1 - retestIndex > 5) continue;

    const zoneTolerance = Math.max(candidate.latestAtr * 0.1, candidate.currentPrice * 0.0012);
    const priceNearZone =
      candidate.currentPrice >= Math.min(gapLow, gapHigh) - zoneTolerance &&
      candidate.currentPrice <= Math.max(gapLow, gapHigh) + zoneTolerance;
    if (!priceNearZone) continue;

    const stopLoss =
      side === "Long"
        ? Math.min(orderBlock.low, gapLow) - candidate.latestAtr * 0.16
        : Math.max(orderBlock.high, gapHigh) + candidate.latestAtr * 0.16;
    const targetReference =
      side === "Long"
        ? candidate.supportResistance?.resistanceLevels?.[0] || candidate.currentPrice + candidate.latestAtr * 2.2
        : candidate.supportResistance?.supportLevels?.[0] || candidate.currentPrice - candidate.latestAtr * 2.2;
    const takeProfit =
      side === "Long"
        ? Math.max(targetReference, equilibrium + candidate.latestAtr * 1.9)
        : Math.min(targetReference, equilibrium - candidate.latestAtr * 1.9);
    const rr = Math.abs(takeProfit - equilibrium) / Math.max(Math.abs(equilibrium - stopLoss), 0.0000001);
    if (rr < EXPERIMENTAL_MIN_RR) continue;

    let qualityScore = 58;
    qualityScore += candleBody(displacement) >= avgBody * 2.5 ? 10 : 6;
    qualityScore += displacement.volume >= avgVolume * 1.5 ? 10 : 4;
    qualityScore += candidate.bias.tone === tone ? 10 : -8;
    qualityScore += candidate.entryQualityScore >= 16 ? 8 : -6;
    qualityScore += side === "Long" ? (candidate.cvdSlope > 0 ? 6 : -6) : candidate.cvdSlope < 0 ? 6 : -6;
    qualityScore += side === "Long" ? (candidate.takerRatio > 1 ? 4 : -4) : candidate.takerRatio < 1 ? 4 : -4;

    const signal = buildExperimentalStrategySignal({
      strategyId: "obfvg",
      side,
      tone,
      qualityScore,
      detectedAt: candles[retestIndex].time * 1000,
      entry: equilibrium,
      stopLoss,
      takeProfit,
      leverage: 5,
      note: "Displacement plus fair value gap retest into the order-block equilibrium.",
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
  const stopLoss = side === "Long" ? entry - candidate.latestAtr * 1.5 : entry + candidate.latestAtr * 1.5;
  const takeProfit = middle;
  const projectedMovePct = Math.abs(pctChange(entry, takeProfit));
  if (projectedMovePct < 0.8) return null;

  let qualityScore = 62;
  qualityScore += Math.min(18, Math.round(Math.abs(candidate.fundingRate) * 180));
  qualityScore += side === "Long" ? (candidate.rsi <= 34 ? 10 : 4) : candidate.rsi >= 66 ? 10 : 4;
  qualityScore += side === "Long" ? (candidate.cvdSlope >= 0 ? 6 : -6) : candidate.cvdSlope <= 0 ? 6 : -6;
  qualityScore += side === "Long" ? (candidate.takerRatio < 1 ? 4 : 0) : candidate.takerRatio > 1 ? 4 : 0;

  return buildExperimentalStrategySignal({
    strategyId: "funding",
    side,
    tone,
    qualityScore,
    detectedAt: currentCandle.time * 1000,
    entry,
    stopLoss,
    takeProfit,
    leverage: 5,
    note: "Extreme funding plus Bollinger extension points to a mean-reversion fade.",
    reason: `Funding ${formatPercent(candidate.fundingRate, 4)} • fade back to the Bollinger basis`,
  });
}

function attachExperimentalSignals(candidate) {
  const strategySignals = {
    liq: buildLiquidationMagnetStrategySignal(candidate),
    obfvg: buildObFvgStrategySignal(candidate),
    funding: buildFundingMeanReversionSignal(candidate),
  };
  const bestExperimentalQuality = Math.max(
    0,
    ...Object.values(strategySignals)
      .filter(Boolean)
      .map((signal) => signal.qualityScore)
  );

  return {
    ...candidate,
    strategySignals,
    bestExperimentalQuality,
  };
}

function initChart() {
  chart = LightweightCharts.createChart(dom.chart, {
    width: dom.chart.clientWidth,
    height: dom.chart.clientHeight,
    layout: {
      background: { color: "#040503" },
      textColor: "#a6ae9a",
      fontFamily: '"IBM Plex Sans", "Helvetica Neue", "Segoe UI", sans-serif',
    },
    grid: {
      vertLines: { color: "rgba(255, 255, 255, 0.04)" },
      horzLines: { color: "rgba(255, 255, 255, 0.06)" },
    },
    timeScale: {
      borderColor: "rgba(255, 255, 255, 0.08)",
      timeVisible: true,
    },
    rightPriceScale: {
      borderColor: "rgba(255, 255, 255, 0.08)",
    },
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: "#57da86",
    downColor: "#e25b5b",
    wickUpColor: "#57da86",
    wickDownColor: "#e25b5b",
    borderVisible: false,
  });

  ema20LineSeries = chart.addLineSeries({
    color: "#d8ff4d",
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });

  ema50LineSeries = chart.addLineSeries({
    color: "#c2cec0",
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });

  volumeSeries = chart.addHistogramSeries({
    priceFormat: { type: "volume" },
    priceScaleId: "",
    color: "rgba(216, 255, 77, 0.2)",
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

function volumeColor(candle) {
  return candle.close >= candle.open ? "rgba(17, 187, 109, 0.4)" : "rgba(224, 76, 76, 0.38)";
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
    const xCoordinate = Number.isFinite(anchorTime) ? chart.timeScale().timeToCoordinate(anchorTime) : null;
    const chartWidth = dom.chart.clientWidth;
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

function renderChartHud(candidate) {
  dom.chartEma20.textContent = formatPrice(candidate.latestEma20, candidate.pricePrecision);
  dom.chartEma50.textContent = formatPrice(candidate.latestEma50, candidate.pricePrecision);
  dom.chartRsi.textContent = Number.isFinite(candidate.latestRsi) ? candidate.latestRsi.toFixed(1) : "-";
  dom.chartVolume.textContent = formatCompactNumber(candidate.latestVolume, 2);
  dom.chartEma20.className = toneFromNumber(candidate.currentPrice - candidate.latestEma20, 0.02);
  dom.chartEma50.className = toneFromNumber(candidate.currentPrice - candidate.latestEma50, 0.02);
  dom.chartRsi.className =
    candidate.latestRsi >= 50 && candidate.latestRsi <= 70 ? "up" : candidate.latestRsi < 45 ? "down" : "neutral";
  dom.chartVolume.className = "up";
}

function renderChart(candidate) {
  const snapshot = candidate.snapshot;
  candleSeries.setData(snapshot.candles);
  volumeSeries.setData(
    snapshot.candles.map((candle) => ({
      time: candle.time,
      value: candle.volume,
      color: volumeColor(candle),
    }))
  );
  ema20LineSeries.setData(candidate.ema20LineData);
  ema50LineSeries.setData(candidate.ema50LineData);
  candleSeries.setMarkers(candidate.markers || []);
  chart.timeScale().fitContent();
  removePriceLines();
  candidate.supportResistance.supportLevels.forEach((level, index) => addLevelLine(level, `S${index + 1}`, "#1db96f"));
  candidate.supportResistance.resistanceLevels.forEach((level, index) => addLevelLine(level, `R${index + 1}`, "#db5555"));
  renderChartSeriesLabels(
    candidate.latestEma20,
    candidate.latestEma50,
    candidate.ema20LineData[candidate.ema20LineData.length - 1]?.time || snapshot.candles[snapshot.candles.length - 1]?.time
  );
  renderChartHud(candidate);
}

function renderSelectedCandidate(candidate) {
  state.selectedAnalysis = candidate;
  state.selectedSnapshot = candidate.snapshot;
  state.selectedToken = candidate.token;
  state.selectedSymbol = candidate.symbol;
  persistState();

  dom.tokenInput.value = candidate.token;
  dom.assetTitle.textContent = `${candidate.symbol} Personal Setup`;
  dom.assetSubtitle.textContent = candidate.activeSignal
    ? `${candidate.activeSignal.touch} retest • ${candidate.activeSignal.side} continuation`
    : "No fresh signal, chart kept loaded for context";
  dom.headlinePrice.textContent = formatPrice(candidate.currentPrice, candidate.pricePrecision);
  dom.headlineChange.textContent = formatPercent(candidate.change24h);
  dom.headlineChange.className = toneFromNumber(candidate.change24h, 0.08);
  dom.headlineBias.textContent = candidate.setupBias.label;
  dom.headlineBias.className = candidate.setupBias.tone;

  const quality = qualityTier(candidate.qualityScore);
  dom.qualityBadge.textContent = `${candidate.qualityScore}`;
  dom.qualityBadge.className = candidate.activeSignal
    ? `score-badge ${candidate.setupBias.tone} ${quality.className}`
    : "score-badge neutral";
  setQualityMeter(candidate.qualityScore);

  setStreamStatus(
    candidate.activeSignal
      ? `${candidate.activeSignal.side} setup active on ${candidate.activeSignal.touch} retest`
      : "Selected token loaded, but no fresh qualifying setup",
    candidate.activeSignal ? candidate.activeSignal.tone : "neutral"
  );

  dom.summaryCopy.textContent = candidate.activeSignal
    ? `${candidate.symbol} currently shows a ${candidate.activeSignal.side.toLowerCase()} continuation idea. Quality ${candidate.qualityScore} reflects the trend stack, touch quality, liquidity, flow confirmation, room to target, and the signal was detected at ${formatDateTime(candidate.activeSignal.detectedAt)}.`
    : `${candidate.symbol} is loaded because it is on your focus list or pinned board, but there is no fresh 1H EMA pullback worth acting on right now.`;

  dom.stancePill.textContent = candidate.activeSignal ? candidate.activeSignal.side : "Waiting";
  dom.stancePill.className = `pill ${candidate.activeSignal ? candidate.activeSignal.tone : "neutral"}`;
  dom.entryZone.textContent = candidate.activeSignal
    ? `${formatPrice(candidate.activeSignal.entryLow, candidate.pricePrecision)} - ${formatPrice(candidate.activeSignal.entryHigh, candidate.pricePrecision)}`
    : "-";
  dom.stop.textContent = candidate.activeSignal ? formatPrice(candidate.activeSignal.stopLoss, candidate.pricePrecision) : "-";
  dom.tp1.textContent = candidate.activeSignal ? formatPrice(candidate.activeSignal.tp1, candidate.pricePrecision) : "-";
  dom.tp2.textContent = candidate.activeSignal ? formatPrice(candidate.activeSignal.tp2, candidate.pricePrecision) : "-";
  dom.planNote.textContent = candidate.activeSignal
    ? `${candidate.activeSignal.touch} • detected ${formatDateTime(candidate.activeSignal.detectedAt)} • ${candidate.activeSignal.sinceTouchBars} bars since touch`
    : "Need a fresh EMA pullback confirmation";
  dom.tradeSummary.textContent = candidate.activeSignal
    ? `${candidate.activeSignal.note} The entry zone sits around the EMA stack, while invalidation stays beyond the touch candle plus ATR buffer.`
    : "No active personal setup selected yet. Scan the perp universe or load a pinned signal.";

  renderLevelBands(
    dom.supportFields,
    candidate.supportResistance.supportLevels,
    candidate.supportResistance.bandWidth,
    "up",
    candidate.pricePrecision
  );
  renderLevelBands(
    dom.resistanceFields,
    candidate.supportResistance.resistanceLevels,
    candidate.supportResistance.bandWidth,
    "down",
    candidate.pricePrecision
  );
  renderSignalList(buildSelectedSignalCards(candidate));
  renderChart(candidate);
}

function renderEmptySelected(message) {
  dom.assetTitle.textContent = "My Signals chart";
  dom.assetSubtitle.textContent = message;
  dom.headlinePrice.textContent = "-";
  dom.headlineChange.textContent = "-";
  dom.headlineBias.textContent = "-";
  dom.qualityBadge.textContent = "0";
  dom.qualityBadge.className = "score-badge neutral";
  setQualityMeter(0);
  dom.summaryCopy.textContent = message;
  dom.stancePill.textContent = "Waiting";
  dom.stancePill.className = "pill neutral";
  dom.entryZone.textContent = "-";
  dom.stop.textContent = "-";
  dom.tp1.textContent = "-";
  dom.tp2.textContent = "-";
  dom.tradeSummary.textContent = "No signal selected.";
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

function signalToPin(candidate) {
  const signal = candidate.activeSignal;
  if (!signal) return null;
  return {
    id: signal.id,
    symbol: candidate.symbol,
    token: candidate.token,
    side: signal.side,
    tone: signal.tone,
    touch: signal.touch,
    qualityScore: signal.qualityScore,
    entryLow: signal.entryLow,
    entryHigh: signal.entryHigh,
    stopLoss: signal.stopLoss,
    tp1: signal.tp1,
    tp2: signal.tp2,
    summary: signal.note,
    detectedAt: signal.detectedAt,
    pinnedAt: Date.now(),
    pricePrecision: candidate.pricePrecision,
  };
}

function pinCandidate(candidate) {
  const pin = signalToPin(candidate);
  if (!pin) {
    setStatus("There is no active setup to pin for the selected token.", "neutral");
    return;
  }

  const existingIndex = state.pinnedSignals.findIndex((item) => item.id === pin.id || item.symbol === pin.symbol);
  if (existingIndex >= 0) state.pinnedSignals.splice(existingIndex, 1);
  state.pinnedSignals.unshift(pin);
  state.pinnedSignals = state.pinnedSignals.slice(0, 20);
  persistState();
  renderPinnedTable();
  updateMetrics();
  setStatus(`${pin.symbol} pinned to My Signals.`, "up");
}

function removePinned(id) {
  state.pinnedSignals = state.pinnedSignals.filter((item) => item.id !== id);
  persistState();
  renderPinnedTable();
  updateMetrics();
}

async function requestAlertPermission() {
  if (typeof Notification === "undefined") {
    state.alertPermission = "unsupported";
    updateAlertButton();
    return;
  }
  state.alertPermission = await Notification.requestPermission();
  updateAlertButton();
}

function updateAlertButton() {
  if (state.alertPermission === "granted") dom.browserAlertsButton.textContent = "Alerts Enabled";
  else if (state.alertPermission === "denied") dom.browserAlertsButton.textContent = "Alerts Blocked";
  else if (state.alertPermission === "unsupported") dom.browserAlertsButton.textContent = "Alerts Unsupported";
  else dom.browserAlertsButton.textContent = "Enable Alerts";
  dom.browserAlertsButton.disabled =
    state.alertPermission === "unsupported" || state.alertPermission === "denied";
}

function flashPrimeSignal(message) {
  setStatus(message, "up");
  dom.statusBanner.classList.add("status-banner-flash");
  if (flashTimer) window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => {
    dom.statusBanner.classList.remove("status-banner-flash");
  }, 7000);
}

function pushPrimeSignal(candidate) {
  const signal = candidate.activeSignal;
  if (!signal || signal.qualityScore < 100) return;
  if (state.primeSignals.some((item) => item.id === signal.id)) return;

  state.primeSignals.unshift({
    id: signal.id,
    symbol: candidate.symbol,
    side: signal.side,
    tone: signal.tone,
    touch: signal.touch,
    qualityScore: signal.qualityScore,
    detectedAt: signal.detectedAt,
    entryLow: signal.entryLow,
    entryHigh: signal.entryHigh,
    tp1: signal.tp1,
    tp2: signal.tp2,
    pricePrecision: candidate.pricePrecision,
  });
  state.primeSignals = state.primeSignals.slice(0, 24);
  persistState();
  renderPrimeFeed();
}

function notifyForCandidate(candidate) {
  const signal = candidate.activeSignal;
  if (!signal) return;
  const isPrime = signal.qualityScore >= 100;
  if (!isPrime && signal.qualityScore < state.qualityThreshold) return;
  if (state.seenSignalIds.has(signal.id)) return;
  state.seenSignalIds.add(signal.id);
  pushPrimeSignal(candidate);
  persistState();

  const primeMessage = isPrime
    ? `Prime signal flashed: ${candidate.symbol} ${signal.side} ${signal.touch} at ${formatDateTime(signal.detectedAt)} • Q${signal.qualityScore}`
    : "";

  if (state.alertPermission === "granted" && typeof Notification !== "undefined") {
    const notification = new Notification(`${isPrime ? "Prime" : "New"} ${candidate.symbol} ${signal.side} setup`, {
      body: `${signal.touch} retest qualified at Q${signal.qualityScore} • ${formatDateTime(signal.detectedAt)}.`,
    });
    window.setTimeout(() => notification.close(), isPrime ? 10000 : 7000);
  }

  return primeMessage;
}

function experimentalReservedMargin(strategyId = null) {
  return state.strategyOpenTrades
    .filter((trade) => !strategyId || trade.strategyId === strategyId)
    .reduce((sum, trade) => sum + (Number(trade.marginUsed) || 0), 0);
}

function experimentalStrategyOpenTrades(strategyId) {
  return state.strategyOpenTrades.filter((trade) => trade.strategyId === strategyId);
}

function experimentalHasOpenTrade(strategyId, symbol = null) {
  return state.strategyOpenTrades.some(
    (trade) => trade.strategyId === strategyId && (!symbol || trade.symbol === symbol)
  );
}

function experimentalRecentlyClosed(symbol, strategyId) {
  return state.strategyClosedTrades.some(
    (trade) =>
      trade.symbol === symbol &&
      trade.strategyId === strategyId &&
      Date.now() - Number(trade.closedAt || 0) < EXPERIMENTAL_TRADE_COOLDOWN_MS
  );
}

function strategyTradeReturnPct(trade, exitPrice) {
  const direction = trade.side === "Short" ? -1 : 1;
  return pctChange(trade.entryPrice, exitPrice) * direction * (trade.leverage || 5);
}

function logExperimentalActivity(message, tone = "neutral") {
  state.strategyActivity.unshift({
    time: Date.now(),
    message,
    tone,
  });
  state.strategyActivity = state.strategyActivity.slice(0, 80);
}

function notifyForExperimentalSignal(candidate, signal) {
  if (!signal || signal.qualityScore < 100) return;
  if (state.seenExperimentalSignalIds.has(signal.id)) return;
  state.seenExperimentalSignalIds.add(signal.id);
  logExperimentalActivity(
    `Prime ${signal.strategyLabel} signal detected on ${candidate.symbol} • ${signal.side} • Q${signal.qualityScore} • ${formatDateTime(
      signal.detectedAt
    )}.`,
    signal.tone
  );

  if (state.alertPermission === "granted" && typeof Notification !== "undefined") {
    const notification = new Notification(`Prime ${signal.strategyLabel} signal`, {
      body: `${candidate.symbol} ${signal.side} • Q${signal.qualityScore} • ${formatDateTime(signal.detectedAt)}`,
    });
    window.setTimeout(() => notification.close(), 10000);
  }

  flashPrimeSignal(
    `Prime ${signal.strategyLabel} signal: ${candidate.symbol} ${signal.side} • Q${signal.qualityScore} • ${formatDateTime(
      signal.detectedAt
    )}`
  );
}

function openExperimentalTradeFromSignal(candidate, strategyId) {
  const signal = candidate.strategySignals?.[strategyId];
  const spec = experimentalStrategySpec(strategyId);
  if (!signal) return false;
  if (experimentalHasOpenTrade(strategyId, candidate.symbol)) return false;
  if (experimentalStrategyOpenTrades(strategyId).length >= spec.maxOpenTrades) return false;
  if (state.strategyOpenTrades.length >= EXPERIMENTAL_MAX_CONCURRENT_TRADES) return false;

  const strategyBalanceBefore = Number(state.strategyBalances?.[strategyId]) || EXPERIMENTAL_START_BALANCE;
  const freeCapital = Math.max(strategyBalanceBefore - experimentalReservedMargin(strategyId), 0);
  if (freeCapital < 10) return false;

  const leverage = signal.leverage || 5;
  const marginBudget = Math.min(
    freeCapital,
    Math.max(strategyBalanceBefore * 0.24, freeCapital / Math.max(1, spec.maxOpenTrades))
  );
  const riskCapital = Math.max(marginBudget * 0.12, 2);
  const stopDistance = Math.abs(signal.entry - signal.stopLoss);
  const quantityByRisk = stopDistance > 0 ? riskCapital / stopDistance : 0;
  const quantityByCapital = (marginBudget * leverage) / signal.entry;
  const quantity = Math.max(0, Math.min(quantityByRisk, quantityByCapital));

  if (!Number.isFinite(quantity) || quantity <= 0) return false;

  state.strategyOpenTrades.push({
    id: `${Date.now()}-${strategyId}-${candidate.symbol}`,
    strategyId,
    strategyLabel: spec.label,
    symbol: candidate.symbol,
    token: candidate.token,
    side: signal.side,
    entryPrice: signal.entry,
    stopLoss: signal.stopLoss,
    takeProfit: signal.takeProfit,
    quantity,
    leverage,
    marginUsed: marginBudget,
    qualityScore: signal.qualityScore,
    targetReturnPct: signal.targetReturnPct,
    stopReturnPct: signal.stopReturnPct,
    pricePrecision: candidate.pricePrecision,
    breakEvenArmed: false,
    profitLockArmed: false,
    detectedAt: signal.detectedAt,
    openedAt: Date.now(),
    strategyBalanceBefore,
    lastPrice: candidate.currentPrice,
  });

  logExperimentalActivity(
    `Opened ${spec.label} ${signal.side} ${candidate.symbol} • entry ${formatPrice(
      signal.entry,
      candidate.pricePrecision
    )} • TP ${formatPrice(signal.takeProfit, candidate.pricePrecision)} • SL ${formatPrice(
      signal.stopLoss,
      candidate.pricePrecision
    )} • quality ${signal.qualityScore}.`,
    signal.tone
  );
  return true;
}

function closeExperimentalTrade(tradeId, reason, exitPrice, precisionHint) {
  const tradeIndex = state.strategyOpenTrades.findIndex((trade) => trade.id === tradeId);
  if (tradeIndex === -1) return;

  const trade = state.strategyOpenTrades[tradeIndex];
  const direction = trade.side === "Short" ? -1 : 1;
  const pnlUsd = (exitPrice - trade.entryPrice) * trade.quantity * direction;
  const returnPct = strategyTradeReturnPct(trade, exitPrice);
  const strategyBalanceAfter =
    (Number(state.strategyBalances[trade.strategyId]) || EXPERIMENTAL_START_BALANCE) + pnlUsd;

  state.strategyClosedTrades.unshift({
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
    returnPct,
    quantity: trade.quantity,
    pricePrecision: trade.pricePrecision,
    strategyBalanceBefore: trade.strategyBalanceBefore,
    strategyBalanceAfter,
  });
  state.strategyClosedTrades = state.strategyClosedTrades.slice(0, 120);
  state.strategyBalances[trade.strategyId] = strategyBalanceAfter;
  state.strategyOpenTrades.splice(tradeIndex, 1);

  logExperimentalActivity(
    `${reason} closed ${trade.strategyLabel} ${trade.side} ${trade.symbol} • entry ${formatPrice(
      trade.entryPrice,
      precisionHint
    )} • exit ${formatPrice(exitPrice, precisionHint)} • ${formatPercent(returnPct)} on margin • ${formatCompactUsd(
      pnlUsd,
      2
    )}.`,
    reason === "TP" ? "up" : "down"
  );
}

function tightenExperimentalTradeProtection(trade, candidate) {
  const direction = trade.side === "Short" ? -1 : 1;
  const targetDistance = Math.abs(trade.takeProfit - trade.entryPrice);
  if (!Number.isFinite(targetDistance) || targetDistance <= 0) return;

  const progress = Math.abs(candidate.currentPrice - trade.entryPrice) / targetDistance;
  const breakevenStop = trade.entryPrice;
  const lockedStop = trade.entryPrice + direction * targetDistance * 0.3;

  if (progress >= 0.45 && !trade.breakEvenArmed) {
    trade.stopLoss = breakevenStop;
    trade.breakEvenArmed = true;
    logExperimentalActivity(`Protected ${trade.symbol} by moving ${trade.strategyLabel} to breakeven.`, "neutral");
  }

  if (progress >= 0.75 && !trade.profitLockArmed) {
    trade.stopLoss = lockedStop;
    trade.profitLockArmed = true;
    logExperimentalActivity(
      `Locked profit on ${trade.symbol}; ${trade.strategyLabel} stop moved to ${formatPrice(
        trade.stopLoss,
        candidate.pricePrecision
      )}.`,
      direction === 1 ? "up" : "down"
    );
  }
}

function refreshExperimentalOpenTrades(candidates) {
  if (!state.strategyOpenTrades.length) return;
  const candidateMap = new Map(candidates.map((candidate) => [candidate.symbol, candidate]));
  const openTrades = [...state.strategyOpenTrades];

  openTrades.forEach((trade) => {
    const candidate = candidateMap.get(trade.symbol);
    if (!candidate) return;
    trade.lastPrice = candidate.currentPrice;
    trade.pricePrecision = candidate.pricePrecision;
    tightenExperimentalTradeProtection(trade, candidate);

    const hitTarget =
      trade.side === "Long"
        ? candidate.currentPrice >= trade.takeProfit
        : candidate.currentPrice <= trade.takeProfit;
    const hitStop =
      trade.side === "Long"
        ? candidate.currentPrice <= trade.stopLoss
        : candidate.currentPrice >= trade.stopLoss;

    if (hitTarget) closeExperimentalTrade(trade.id, "TP", trade.takeProfit, candidate.pricePrecision);
    else if (hitStop) closeExperimentalTrade(trade.id, "SL", trade.stopLoss, candidate.pricePrecision);
  });
}

function experimentalQualityThreshold() {
  return Math.max(68, state.qualityThreshold);
}

function qualifiedExperimentalCandidates(candidates, strategyId, threshold) {
  return candidates
    .filter((candidate) => {
      const signal = candidate.strategySignals?.[strategyId];
      return signal && signal.qualityScore >= threshold;
    })
    .sort(
      (left, right) =>
        (right.strategySignals?.[strategyId]?.qualityScore || 0) -
        (left.strategySignals?.[strategyId]?.qualityScore || 0)
    );
}

function openQualifiedExperimentalTrades(candidates) {
  const opened = [];
  const threshold = experimentalQualityThreshold();

  EXPERIMENTAL_STRATEGY_SPECS.forEach((spec) => {
    if (opened.length >= EXPERIMENTAL_MAX_NEW_TRADES_PER_SCAN) return;
    if (experimentalStrategyOpenTrades(spec.id).length >= spec.maxOpenTrades) return;

    const candidate = qualifiedExperimentalCandidates(candidates, spec.id, threshold).find(
      (entry) => !experimentalHasOpenTrade(spec.id, entry.symbol) && !experimentalRecentlyClosed(entry.symbol, spec.id)
    );

    if (candidate && openExperimentalTradeFromSignal(candidate, spec.id)) {
      opened.push({
        strategyId: spec.id,
        strategyLabel: spec.label,
        symbol: candidate.symbol,
        signal: candidate.strategySignals[spec.id],
      });
    }
  });

  return opened;
}

function renderExperimentalStrategyLab() {
  const threshold = experimentalQualityThreshold();
  const candidates = state.experimentalCandidates || [];

  if (dom.strategySleeveGrid) {
    renderAnalysisGrid(
      dom.strategySleeveGrid,
      EXPERIMENTAL_STRATEGY_SPECS.map((spec) => {
        const realizedBalance = Number(state.strategyBalances?.[spec.id]) || EXPERIMENTAL_START_BALANCE;
        const openTrades = experimentalStrategyOpenTrades(spec.id);
        const unrealizedUsd = openTrades.reduce((sum, trade) => {
          const direction = trade.side === "Short" ? -1 : 1;
          if (!Number.isFinite(trade.lastPrice)) return sum;
          return sum + (trade.lastPrice - trade.entryPrice) * trade.quantity * direction;
        }, 0);
        const equity = realizedBalance + unrealizedUsd;
        const closed = state.strategyClosedTrades.filter((trade) => trade.strategyId === spec.id);
        const wins = closed.filter((trade) => trade.reason === "TP").length;
        const lead = qualifiedExperimentalCandidates(candidates, spec.id, threshold)[0] || null;
        return {
          label: spec.label,
          value: `${formatPrice(equity, 2)} • ${openTrades.length} open`,
          note: lead
            ? `${lead.symbol} ${lead.strategySignals[spec.id].side} • Q${lead.strategySignals[spec.id].qualityScore} • ${formatPercent(
                lead.strategySignals[spec.id].projectedMovePct
              )} move • ${wins}/${closed.length} wins`
            : `${wins}/${closed.length} wins • no live ${spec.shortLabel.toLowerCase()} signal above Q${threshold}`,
          tone:
            equity > EXPERIMENTAL_START_BALANCE + 0.5
              ? "up"
              : equity < EXPERIMENTAL_START_BALANCE - 0.5
                ? "down"
                : spec.tone,
        };
      })
    );
  }

  renderAnalysisGrid(
    dom.strategyOpenGrid,
    state.strategyOpenTrades.length
      ? state.strategyOpenTrades.slice(0, 6).map((trade) => ({
          label: `${trade.strategyLabel} • ${trade.symbol} ${trade.side}`,
          value: `${formatPercent(strategyTradeReturnPct(trade, trade.lastPrice || trade.entryPrice))} live`,
          note: `Entry ${formatPrice(trade.entryPrice, trade.pricePrecision || 2)} • TP ${formatPrice(
            trade.takeProfit,
            trade.pricePrecision || 2
          )} • SL ${formatPrice(trade.stopLoss, trade.pricePrecision || 2)} • detected ${formatDateTime(
            trade.detectedAt
          )} • margin ${formatPrice(trade.marginUsed, 2)} • ${trade.leverage}x`,
          tone: trade.side === "Long" ? "up" : "down",
        }))
      : [
          {
            label: "Experimental engine waiting",
            value: "No open trade",
            note: "The three experimental sleeves will open the next qualified strategy signal automatically.",
            tone: "neutral",
          },
        ]
  );

  renderTable(
    dom.strategyTradeLog,
    state.strategyClosedTrades.slice(0, 12).map((trade) => ({
      label: `${trade.strategyLabel} • ${trade.symbol} ${trade.side} • ${trade.reason}`,
      primary: `Entry ${formatPrice(trade.entryPrice, trade.pricePrecision || 2)} • Exit ${formatPrice(
        trade.exitPrice,
        trade.pricePrecision || 2
      )}`,
      secondaryLabel: "Plan",
      secondary: `TP ${formatPrice(trade.takeProfit, trade.pricePrecision || 2)} • SL ${formatPrice(
        trade.stopLoss,
        trade.pricePrecision || 2
      )} • ${formatDateTime(trade.detectedAt || trade.openedAt)}`,
      tertiaryLabel: "Result",
      tertiary: `${formatPercent(trade.returnPct || 0)} on margin • ${formatCompactUsd(
        trade.pnlUsd,
        2
      )} • Sleeve ${formatPrice(trade.strategyBalanceAfter, 2)}`,
      tone: trade.reason === "TP" ? "up" : "down",
    })),
    "No experimental strategy trades have closed yet"
  );

  renderTable(
    dom.strategyActivityTable,
    state.strategyActivity.slice(0, 12).map((item) => ({
      label: new Date(item.time).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      primary: item.message,
      secondaryLabel: "Mode",
      secondary: "Auto",
      tertiaryLabel: "Status",
      tertiary: item.tone === "up" ? "Constructive" : item.tone === "down" ? "Defensive" : "Watching",
      tone: item.tone,
    })),
    "No experimental engine activity yet"
  );

  updateStrategyTabs();
}

function renderLiveTable() {
  const rows = state.liveSignals
    .filter((candidate) => candidate.activeSignal && candidate.qualityScore >= state.qualityThreshold)
    .map((candidate) => {
      const signal = candidate.activeSignal;
      const quality = qualityTier(candidate.qualityScore);
      return `
        <tr>
          <td class="monitor-symbol">${candidate.symbol}<div class="monitor-subtle">${volumeTier(Number(candidate.snapshot.ticker?.quoteVolume) || 0).label}</div></td>
          <td>${formatDateTime(signal.detectedAt)}</td>
          <td><strong class="${signal.tone}">${signal.side}</strong></td>
          <td>${signal.touch}</td>
          <td>${formatPrice(candidate.currentPrice, candidate.pricePrecision)}</td>
          <td>${formatPrice(signal.entryLow, candidate.pricePrecision)} - ${formatPrice(signal.entryHigh, candidate.pricePrecision)}</td>
          <td>${formatPrice(signal.stopLoss, candidate.pricePrecision)}</td>
          <td>${formatPrice(signal.tp1, candidate.pricePrecision)} / ${formatPrice(signal.tp2, candidate.pricePrecision)}</td>
          <td>${signal.reasonParts.slice(0, 3).join(" • ")}</td>
          <td class="quality-column quality-column-centered">
            <span class="quality-chip ${quality.className}" title="${quality.label}">Q${candidate.qualityScore}</span>
          </td>
          <td class="signals-actions-cell">
            <button class="mini-button signals-load-button" type="button" data-symbol="${candidate.symbol}">Load</button>
            <button class="mini-button signals-pin-button" type="button" data-pin-symbol="${candidate.symbol}">Pin</button>
          </td>
        </tr>
      `;
    });

  renderMonitorTable(
    dom.liveTable,
    [
      "Pair",
      "Detected",
      "Side",
      "Touch",
      "Price",
      "Entry Zone",
      "Stop",
      "Targets",
      "Why It Qualifies",
      '<span class="quality-column-heading">Quality</span>',
      "Actions",
    ],
    rows,
    "No rotating universe token currently clears the active EMA pullback quality threshold."
  );

  dom.liveTable.querySelectorAll("[data-symbol]").forEach((button) => {
    button.addEventListener("click", () => {
      const symbol = button.getAttribute("data-symbol");
      if (!symbol) return;
      const candidate = lastSignalMap.get(symbol);
      if (candidate) renderSelectedCandidate(candidate);
    });
  });

  dom.liveTable.querySelectorAll("[data-pin-symbol]").forEach((button) => {
    button.addEventListener("click", () => {
      const symbol = button.getAttribute("data-pin-symbol");
      if (!symbol) return;
      const candidate = lastSignalMap.get(symbol);
      if (candidate) pinCandidate(candidate);
    });
  });
}

function renderPinnedTable() {
  if (!state.pinnedSignals.length) {
    dom.pinnedTable.innerHTML = `
      <div class="table-row">
        <div>
          <span>Status</span>
          <strong>No pinned setups yet</strong>
        </div>
        <div>
          <span>Suggestion</span>
          <strong>Pin the current setup or one from the live board.</strong>
        </div>
        <div>
          <span>Scope</span>
          <strong>Saved only on this browser</strong>
        </div>
      </div>
    `;
    return;
  }

  dom.pinnedTable.innerHTML = state.pinnedSignals
    .map(
      (item) => `
        <div class="table-row">
          <div>
            <span>${item.symbol} • ${item.side}</span>
            <strong class="${item.tone}">Pinned ${formatDateTime(item.pinnedAt)}</strong>
          </div>
          <div>
            <span>Plan</span>
            <strong>${formatPrice(item.entryLow, item.pricePrecision)} - ${formatPrice(item.entryHigh, item.pricePrecision)} • TP ${formatPrice(item.tp1, item.pricePrecision)} • ${formatDateTime(item.detectedAt)}</strong>
          </div>
          <div>
            <span>Actions</span>
            <strong class="signals-inline-actions">
              <button class="mini-button signals-pinned-load" type="button" data-load-pin="${item.symbol}">Load</button>
              <button class="mini-button signals-pinned-remove" type="button" data-remove-pin="${item.id}">Remove</button>
            </strong>
          </div>
        </div>
      `
    )
    .join("");

  dom.pinnedTable.querySelectorAll("[data-load-pin]").forEach((button) => {
    button.addEventListener("click", async () => {
      const symbol = button.getAttribute("data-load-pin");
      if (!symbol) return;
      const candidate = lastSignalMap.get(symbol);
      if (candidate) {
        renderSelectedCandidate(candidate);
      } else {
        await loadToken(symbol);
      }
    });
  });

  dom.pinnedTable.querySelectorAll("[data-remove-pin]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-remove-pin");
      if (!id) return;
      removePinned(id);
    });
  });
}

function renderQualityFeed() {
  const qualified = state.liveSignals
    .filter((candidate) => candidate.activeSignal && candidate.qualityScore >= state.qualityThreshold)
    .slice(0, 8);

  if (!qualified.length) {
    dom.qualityFeed.innerHTML = `
      <div class="table-row">
        <div>
          <span>Status</span>
          <strong>No quality signals live</strong>
        </div>
        <div>
          <span>Scope</span>
          <strong>The rotating perp scan is still looking for cleaner EMA pullbacks.</strong>
        </div>
      </div>
    `;
    return;
  }

  dom.qualityFeed.innerHTML = qualified
    .map((candidate) => {
      const signal = candidate.activeSignal;
      const quality = qualityTier(candidate.qualityScore);
      return `
        <div class="table-row">
          <div>
            <span>${candidate.symbol} • ${signal.side}</span>
            <strong class="${signal.tone}">${signal.touch} • ${formatDateTime(signal.detectedAt)}</strong>
          </div>
          <div>
            <span>Plan</span>
            <strong>${formatPrice(signal.entryLow, candidate.pricePrecision)} - ${formatPrice(signal.entryHigh, candidate.pricePrecision)} • TP ${formatPrice(signal.tp1, candidate.pricePrecision)}</strong>
          </div>
          <div>
            <span>Quality</span>
            <strong class="signals-side-actions">
              <span class="quality-chip ${quality.className}">Q${candidate.qualityScore}</span>
              <button class="mini-button signals-load-button" type="button" data-quality-symbol="${candidate.symbol}">Load</button>
            </strong>
          </div>
        </div>
      `;
    })
    .join("");

  dom.qualityFeed.querySelectorAll("[data-quality-symbol]").forEach((button) => {
    button.addEventListener("click", () => {
      const symbol = button.getAttribute("data-quality-symbol");
      if (!symbol) return;
      const candidate = lastSignalMap.get(symbol);
      if (candidate) renderSelectedCandidate(candidate);
    });
  });
}

function renderPrimeFeed() {
  if (!state.primeSignals.length) {
    dom.primeFeed.innerHTML = `
      <div class="table-row">
        <div>
          <span>Status</span>
          <strong>No prime alerts yet</strong>
        </div>
        <div>
          <span>Trigger</span>
          <strong>Q100+ universe signals will flash here.</strong>
        </div>
      </div>
    `;
    return;
  }

  dom.primeFeed.innerHTML = state.primeSignals
    .slice(0, 10)
    .map((item) => {
      const quality = qualityTier(item.qualityScore);
      return `
        <div class="table-row">
          <div>
            <span>${item.symbol} • ${item.side}</span>
            <strong class="${item.tone}">${item.touch} • ${formatDateTime(item.detectedAt)}</strong>
          </div>
          <div>
            <span>Plan</span>
            <strong>${formatPrice(item.entryLow, item.pricePrecision)} - ${formatPrice(item.entryHigh, item.pricePrecision)} • TP ${formatPrice(item.tp1, item.pricePrecision)}</strong>
          </div>
          <div>
            <span>Prime</span>
            <strong class="signals-side-actions">
              <span class="quality-chip ${quality.className}">Q${item.qualityScore}</span>
              <button class="mini-button signals-load-button" type="button" data-prime-symbol="${item.symbol}">Load</button>
            </strong>
          </div>
        </div>
      `;
    })
    .join("");

  dom.primeFeed.querySelectorAll("[data-prime-symbol]").forEach((button) => {
    button.addEventListener("click", async () => {
      const symbol = button.getAttribute("data-prime-symbol");
      if (!symbol) return;
      const candidate = lastSignalMap.get(symbol);
      if (candidate) {
        renderSelectedCandidate(candidate);
      } else {
        await loadToken(symbol);
      }
    });
  });
}

function renderStrategyNotes() {
  renderAnalysisGrid(dom.notesGrid, [
    {
      label: "Fresh retests",
      value: "Prefer 0-3 bars old",
      note: "The signal stays strongest when the touch is fresh. Older pullbacks degrade quickly because the move is already maturing.",
      tone: "up",
    },
    {
      label: "Best touch",
      value: "EMA20 first, EMA50 second",
      note: "EMA20 retests usually hold cleaner in strong trends. EMA50 retests can still work, but they often mean a slower or more corrective structure.",
      tone: "neutral",
    },
    {
      label: "Avoid crowding",
      value: "No room into levels",
      note: "Even when the EMA touch is valid, skip it if price is already pressing nearby resistance on longs or nearby support on shorts.",
      tone: "down",
    },
    {
      label: "Confirm flow",
      value: "Volume + taker bias",
      note: "The setup improves materially when the touch candle trades on healthy volume and taker flow leans in the same direction as the continuation.",
      tone: "up",
    },
  ]);
}

function updateSideTabs() {
  const tabs = [
    {
      key: "selected",
      button: dom.sideTabSelected,
      panel: dom.sidePanelSelected,
      note: "Selected Setup keeps the focused chart, live plan, and immediate context visible.",
    },
    {
      key: "quality",
      button: dom.sideTabQuality,
      panel: dom.sidePanelQuality,
      note: "Quality Feed surfaces the strongest rotating-universe EMA signals detected right now.",
    },
    {
      key: "prime",
      button: dom.sideTabPrime,
      panel: dom.sidePanelPrime,
      note: "Prime Alerts tracks Q100+ pullbacks so they are easy to spot and revisit.",
    },
  ];

  tabs.forEach((tab) => {
    tab.button.classList.toggle("is-active", state.sideTab === tab.key);
    tab.panel.hidden = state.sideTab !== tab.key;
    if (state.sideTab === tab.key) dom.sideNote.textContent = tab.note;
  });
}

function updateStrategyTabs() {
  const tabs = [
    {
      key: "positions",
      button: dom.strategyTabPositions,
      panel: dom.strategyPanelPositions,
      note: "Open Positions shows the live experimental trades from Liq Magnet, OB + FVG, and Funding MR.",
    },
    {
      key: "trades",
      button: dom.strategyTabTrades,
      panel: dom.strategyPanelTrades,
      note: "Strategy Journal tracks every experimental exit with TP, SL, detection time, and sleeve balance.",
    },
    {
      key: "activity",
      button: dom.strategyTabActivity,
      panel: dom.strategyPanelActivity,
      note: "Activity Feed shows new experimental signal detections, openings, exits, and prime alerts.",
    },
  ];

  tabs.forEach((tab) => {
    if (!tab.button || !tab.panel) return;
    tab.button.classList.toggle("is-active", state.strategyTab === tab.key);
    tab.panel.hidden = state.strategyTab !== tab.key;
    if (state.strategyTab === tab.key && dom.strategyTabNote) dom.strategyTabNote.textContent = tab.note;
  });
}

function updateTabs() {
  const tabs = [
    { key: "live", button: dom.tabLive, panel: dom.panelLive, note: "Universe Feed shows the strongest EMA pullback names currently detected from the rotating perp scan." },
    { key: "pinned", button: dom.tabPinned, panel: dom.panelPinned, note: "Pinned Signals keeps your saved trade ideas separate from the live scan so you can revisit them without clutter." },
    { key: "notes", button: dom.tabNotes, panel: dom.panelNotes, note: "Guardrails keeps the strategy honest so we do not confuse every EMA touch with a real continuation edge." },
  ];

  tabs.forEach((tab) => {
    tab.button.classList.toggle("is-active", state.activeTab === tab.key);
    tab.panel.hidden = state.activeTab !== tab.key;
    if (state.activeTab === tab.key) dom.tabNote.textContent = tab.note;
  });
}

function updateMetrics() {
  const qualified = state.liveSignals.filter((candidate) => candidate.activeSignal && candidate.qualityScore >= state.qualityThreshold);
  const longCount = qualified.filter((candidate) => candidate.activeSignal.side === "Long").length;
  const shortCount = qualified.filter((candidate) => candidate.activeSignal.side === "Short").length;
  const experimentalQualified = (state.experimentalCandidates || []).reduce((count, candidate) => {
    const hasQualifiedStrategy = Object.values(candidate.strategySignals || {}).some(
      (signal) => signal && signal.qualityScore >= experimentalQualityThreshold()
    );
    return count + (hasQualifiedStrategy ? 1 : 0);
  }, 0);

  dom.metricWatchlist.textContent = `${state.watchlist.length}`;
  dom.metricWatchlistNote.textContent = state.watchlist.length
    ? `Focus list • ${state.watchlist.join(", ")}`
    : "Focus list is empty";
  dom.metricQualified.textContent = `${qualified.length}`;
  dom.metricQualifiedNote.textContent = `Quality >= ${state.qualityThreshold} across the rotating perp universe`;
  dom.metricPinned.textContent = `${state.pinnedSignals.length}`;
  dom.metricPinnedNote.textContent = state.pinnedSignals.length ? "Saved personal signal ideas" : "No pinned setups yet";
  dom.metricLongs.textContent = `${longCount}`;
  dom.metricLongsNote.textContent = longCount ? "Bullish pullbacks are active" : "No qualified longs";
  dom.metricShorts.textContent = `${shortCount}`;
  dom.metricShortsNote.textContent = shortCount ? "Bearish pullbacks are active" : "No qualified shorts";
  dom.metricLastScan.textContent = formatClock(state.lastScanAt);
  dom.metricLastScanNote.textContent = state.lastScanAt ? "Universe rotates every 5m" : "First scan pending";
  dom.autoNote.textContent = `Full perp universe rotates every 5 minutes. ${qualified.length} EMA names qualify, and ${experimentalQualified} experimental strategy candidates are currently live.`;
}

async function loadToken(token) {
  setStatus(`Loading ${normalizeToken(token)} into My Signals...`, "neutral");
  try {
    const snapshot = await fetchEngineSnapshot(token);
    const candidate = buildPullbackSignals(snapshot);
    renderSelectedCandidate(candidate);
    setStatus(`${snapshot.symbol} loaded into My Signals.`, "up");
  } catch (error) {
    console.error(error);
    renderEmptySelected(error.message || "Unable to load the selected signal chart.");
    setStatus(error.message || "My Signals chart failed to load.", "down");
  }
}

async function scanWatchlist(manual = false) {
  const focusList = parseWatchlist(dom.watchlistInput.value);
  state.watchlist = focusList.length ? focusList : [...DEFAULT_WATCHLIST];
  state.qualityThreshold = Math.max(50, Number(dom.qualityThreshold.value) || DEFAULT_QUALITY_THRESHOLD);
  persistState();

  setStatus(
    manual
      ? "Running manual full-universe scan..."
      : "Scanning the rotating perp universe for EMA20/50 pullback setups...",
    "neutral"
  );

  try {
    const universe = await getPerpUniverse();
    const tickers = await fetchUniverseTickers();
    universeTickerMap = buildTickerLookup(tickers);

    const prioritizedSymbolInfos = Array.from(
      new Map(
        [
          state.selectedToken,
          ...state.watchlist,
          ...state.strategyOpenTrades.map((trade) => trade.symbol),
        ]
          .map((token) => normalizeToken(token))
          .map((token) => {
            try {
              return resolvePerpSymbol(token, { symbols: universe });
            } catch (error) {
              return null;
            }
          })
          .filter(Boolean)
          .map((resolved) => [resolved.symbol, universe.find((item) => item.symbol === resolved.symbol)])
          .filter((entry) => entry[1])
      ).values()
    );

    const rotatingBatch = selectUniverseBatch(universe);
    const batch = Array.from(
      new Map([...prioritizedSymbolInfos, ...rotatingBatch].map((item) => [item.symbol, item])).values()
    );
    const scanStartedAt = Date.now();

    const results = await mapWithConcurrency(batch, ANALYSIS_CONCURRENCY, async (symbolInfo) => {
      try {
        const snapshot = await fetchEngineSnapshot(symbolInfo.symbol);
        const candidate = attachExperimentalSignals(buildPullbackSignals(snapshot));
        candidate.lastSeenAt = scanStartedAt;
        return candidate;
      } catch (error) {
        return null;
      }
    });

    results.filter(Boolean).forEach((candidate) => {
      if (candidate.activeSignal && candidate.activeSignal.sinceTouchBars <= 3) {
        candidate.lastSeenAt = scanStartedAt;
        universeSignalMap.set(candidate.symbol, candidate);
      } else {
        universeSignalMap.delete(candidate.symbol);
      }
    });

    for (const [symbol, candidate] of universeSignalMap.entries()) {
      if (scanStartedAt - Number(candidate.lastSeenAt || 0) > AUTO_SCAN_MS * 6) {
        universeSignalMap.delete(symbol);
      }
    }

    state.liveSignals = Array.from(universeSignalMap.values())
      .sort((left, right) => right.qualityScore - left.qualityScore)
      .slice(0, 48);
    state.experimentalCandidates = results
      .filter(Boolean)
      .sort((left, right) => (right.bestExperimentalQuality || 0) - (left.bestExperimentalQuality || 0))
      .slice(0, 48);
    lastSignalMap = new Map(
      [...state.experimentalCandidates, ...state.liveSignals].map((candidate) => [candidate.symbol, candidate])
    );
    state.lastScanAt = scanStartedAt;
    refreshExperimentalOpenTrades(state.experimentalCandidates);
    const openedExperimental = openQualifiedExperimentalTrades(state.experimentalCandidates);

    const primeMessages = [];
    state.liveSignals.forEach((candidate) => {
      const primeMessage = notifyForCandidate(candidate);
      if (primeMessage) primeMessages.push(primeMessage);
    });
    state.experimentalCandidates.forEach((candidate) => {
      Object.values(candidate.strategySignals || {}).forEach((signal) => {
        if (signal) notifyForExperimentalSignal(candidate, signal);
      });
    });
    persistState();
    renderLiveTable();
    renderQualityFeed();
    renderPrimeFeed();
    renderPinnedTable();
    renderExperimentalStrategyLab();
    updateSideTabs();
    updateMetrics();

    const selectedCandidate = state.selectedSymbol ? lastSignalMap.get(state.selectedSymbol) : null;
    if (selectedCandidate) {
      renderSelectedCandidate(selectedCandidate);
    } else if (state.liveSignals.length) {
      renderSelectedCandidate(state.liveSignals[0]);
    } else if (!state.selectedAnalysis) {
      await loadToken(state.selectedToken);
    }

    const qualifiedCount = state.liveSignals.filter(
      (candidate) => candidate.activeSignal && candidate.qualityScore >= state.qualityThreshold
    ).length;
    const experimentalQualified = state.experimentalCandidates.reduce((count, candidate) => {
      const hasQualifiedStrategy = Object.values(candidate.strategySignals || {}).some(
        (signal) => signal && signal.qualityScore >= experimentalQualityThreshold()
      );
      return count + (hasQualifiedStrategy ? 1 : 0);
    }, 0);
    setStatus(
      openedExperimental.length
        ? `Experimental lab opened ${openedExperimental.length} trade${openedExperimental.length > 1 ? "s" : ""}. ${qualifiedCount} EMA setups and ${experimentalQualified} experimental candidates are currently live.`
        : qualifiedCount || experimentalQualified
          ? `${qualifiedCount} EMA setups and ${experimentalQualified} experimental strategy candidates are live from ${batch.length} freshly scanned perps.`
          : `Universe scan complete. ${batch.length} perps refreshed and no signal currently clears the active bars.`,
      openedExperimental.length || qualifiedCount || experimentalQualified ? "up" : "neutral"
    );
    if (primeMessages.length) flashPrimeSignal(primeMessages[0]);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Universe scan failed.", "down");
    renderQualityFeed();
    renderPrimeFeed();
    renderExperimentalStrategyLab();
    updateSideTabs();
    if (!state.selectedAnalysis) renderEmptySelected(error.message || "Waiting for perp-universe data.");
  }
}

function startAutoScan() {
  if (scanTimer) window.clearInterval(scanTimer);
  scanTimer = window.setInterval(() => {
    scanWatchlist(false);
  }, AUTO_SCAN_MS);
}

function bindEvents() {
  dom.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.selectedToken = normalizeToken(dom.tokenInput.value);
    persistState();
    await loadToken(state.selectedToken);
    await scanWatchlist(true);
  });

  dom.pinCurrentButton.addEventListener("click", () => {
    if (state.selectedAnalysis) pinCandidate(state.selectedAnalysis);
    else setStatus("Load a setup first before pinning it.", "neutral");
  });

  dom.browserAlertsButton.addEventListener("click", requestAlertPermission);
  dom.clearPinsButton.addEventListener("click", () => {
    state.pinnedSignals = [];
    persistState();
    renderPinnedTable();
    updateMetrics();
    setStatus("Pinned signals cleared.", "neutral");
  });

  dom.tabLive.addEventListener("click", () => {
    state.activeTab = "live";
    persistState();
    updateTabs();
  });
  dom.tabPinned.addEventListener("click", () => {
    state.activeTab = "pinned";
    persistState();
    updateTabs();
  });
  dom.tabNotes.addEventListener("click", () => {
    state.activeTab = "notes";
    persistState();
    updateTabs();
  });

  dom.sideTabSelected.addEventListener("click", () => {
    state.sideTab = "selected";
    persistState();
    updateSideTabs();
  });

  dom.sideTabQuality.addEventListener("click", () => {
    state.sideTab = "quality";
    persistState();
    updateSideTabs();
  });

  dom.sideTabPrime.addEventListener("click", () => {
    state.sideTab = "prime";
    persistState();
    updateSideTabs();
  });

  if (dom.strategyTabPositions) {
    dom.strategyTabPositions.addEventListener("click", () => {
      state.strategyTab = "positions";
      persistState();
      updateStrategyTabs();
    });
  }

  if (dom.strategyTabTrades) {
    dom.strategyTabTrades.addEventListener("click", () => {
      state.strategyTab = "trades";
      persistState();
      updateStrategyTabs();
    });
  }

  if (dom.strategyTabActivity) {
    dom.strategyTabActivity.addEventListener("click", () => {
      state.strategyTab = "activity";
      persistState();
      updateStrategyTabs();
    });
  }
}

async function init() {
  applyExperimentalStrategyUpgrade();
  dom.tokenInput.value = state.selectedToken;
  dom.watchlistInput.value = state.watchlist.join(", ");
  dom.qualityThreshold.value = `${state.qualityThreshold}`;
  updateTabs();
  updateSideTabs();
  updateStrategyTabs();
  updateAlertButton();
  renderStrategyNotes();
  renderPinnedTable();
  renderQualityFeed();
  renderPrimeFeed();
  renderExperimentalStrategyLab();
  initChart();
  bindEvents();
  updateMetrics();
  await loadToken(state.selectedToken);
  await scanWatchlist(false);
  startAutoScan();
}

init();
