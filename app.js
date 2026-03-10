const DEFAULT_TOKEN = "BTC";
const DEFAULT_INTERVAL = "15m";
const QUOTE_ASSET = "USDT";
const MAX_TRADE_SAMPLES = 450;
const MAX_FORCE_ORDERS = 50;
const STREAM_RECONNECT_DELAY_MS = 1500;
const RENDER_THROTTLE_MS = 220;
const TRADE_AUTO_REFRESH_MS = 15 * 60 * 1000;
const TIMEFRAME_FETCH_LIMIT = 240;
const TIMEFRAME_SUMMARY_CONFIG = [
  { key: "10m", label: "10m", fetchInterval: "5m", aggregateSeconds: 10 * 60 },
  { key: "30m", label: "30m", fetchInterval: "30m", aggregateSeconds: null },
  { key: "1h", label: "1H", fetchInterval: "1h", aggregateSeconds: null },
  { key: "4h", label: "4H", fetchInterval: "4h", aggregateSeconds: null },
  { key: "1d", label: "1D", fetchInterval: "1d", aggregateSeconds: null },
];

const dom = {
  assetTitle: document.getElementById("asset-title"),
  assetSubtitle: document.getElementById("asset-subtitle"),
  headlinePrice: document.getElementById("headline-price"),
  headlineChange: document.getElementById("headline-change"),
  headlineBias: document.getElementById("headline-bias"),
  supportFields: document.getElementById("support-fields"),
  resistanceFields: document.getElementById("resistance-fields"),
  outlookSummary: document.getElementById("outlook-summary"),
  signalList: document.getElementById("signal-list"),
  biasScore: document.getElementById("bias-score"),
  statusBanner: document.getElementById("status-banner"),
  streamStatus: document.getElementById("stream-status"),
  metricVolume: document.getElementById("metric-volume"),
  metricVolumeNote: document.getElementById("metric-volume-note"),
  metricImbalance: document.getElementById("metric-imbalance"),
  metricImbalanceNote: document.getElementById("metric-imbalance-note"),
  metricCvd: document.getElementById("metric-cvd"),
  metricCvdNote: document.getElementById("metric-cvd-note"),
  metricFunding: document.getElementById("metric-funding"),
  metricFundingNote: document.getElementById("metric-funding-note"),
  metricOi: document.getElementById("metric-oi"),
  metricOiNote: document.getElementById("metric-oi-note"),
  metricLiq: document.getElementById("metric-liq"),
  metricLiqNote: document.getElementById("metric-liq-note"),
  taGrid: document.getElementById("ta-grid"),
  flowGrid: document.getElementById("flow-grid"),
  fundingGrid: document.getElementById("funding-grid"),
  setupGrid: document.getElementById("setup-grid"),
  flowTable: document.getElementById("flow-table"),
  depthTable: document.getElementById("depth-table"),
  liquidationTable: document.getElementById("liquidation-table"),
  newsFeed: document.getElementById("news-feed"),
  chartEma20: document.getElementById("chart-ema20"),
  chartEma50: document.getElementById("chart-ema50"),
  chartRsi: document.getElementById("chart-rsi"),
  chartVolume: document.getElementById("chart-volume"),
  timeframeSummaryCopy: document.getElementById("timeframe-summary-copy"),
  tradeStance: document.getElementById("trade-stance"),
  tradeEntry: document.getElementById("trade-entry"),
  tradeTp1: document.getElementById("trade-tp1"),
  tradeTp2: document.getElementById("trade-tp2"),
  tradeSl: document.getElementById("trade-sl"),
  tradeSummary: document.getElementById("trade-summary"),
  tradeRefreshButton: document.getElementById("trade-refresh-button"),
  tradeRefreshNote: document.getElementById("trade-refresh-note"),
  tokenForm: document.getElementById("token-form"),
  tokenInput: document.getElementById("token-input"),
  intervalSelect: document.getElementById("interval-select"),
  chart: document.getElementById("chart"),
};

const state = {
  requestId: 0,
  snapshot: null,
  candles: [],
  tradeHistory: [],
  forceOrders: [],
  liveDepth: null,
  liveMarkPrice: null,
  liveIndexPrice: null,
  liveFundingRate: null,
  liveNextFundingTime: null,
  liveLastPrice: null,
  streams: [],
  renderTimer: null,
  tradeRefreshTimer: null,
  timeframeSummary: [],
  timeframeSummaryLoading: false,
  activeToken: DEFAULT_TOKEN,
  activeInterval: DEFAULT_INTERVAL,
};

let chart;
let candleSeries;
let volumeSeries;
let ema20LineSeries;
let ema50LineSeries;
let priceLines = [];
let chartResizeBound = false;

function setStatus(message, tone = "neutral") {
  dom.statusBanner.textContent = message;
  dom.statusBanner.className = `status-banner ${tone}`;
}

function setStreamStatus(message, tone = "neutral") {
  dom.streamStatus.textContent = message;
  dom.streamStatus.className = `stream-status ${tone}`;
}

function setTradeRefreshNote(message) {
  dom.tradeRefreshNote.textContent = message;
}

function normalizeToken(rawToken) {
  const cleaned = String(rawToken || "")
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]/g, "");

  if (!cleaned) return DEFAULT_TOKEN;
  if (cleaned.endsWith(QUOTE_ASSET)) {
    return cleaned.slice(0, -QUOTE_ASSET.length) || DEFAULT_TOKEN;
  }
  return cleaned;
}

function newsCategoryToken(token) {
  const stripped = String(token || "").replace(/^\d+/, "");
  return stripped || token || DEFAULT_TOKEN;
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

function resolvePerpSymbolFromExchangeInfo(rawToken, exchangeInfo) {
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
  const suggestions = ranked.slice(0, 6).map((entry) => entry.symbolInfo.symbol);

  if (!resolved) {
    throw new Error(
      `No USDT perpetual contract found for "${cleanedToken}".${
        suggestions.length ? ` Try ${suggestions.join(", ")}.` : ""
      }`
    );
  }

  const exactMatch =
    resolved.baseAsset === cleanedToken ||
    resolved.symbol === cleanedToken ||
    resolved.symbol === `${cleanedToken}${QUOTE_ASSET}`;

  return {
    cleanedToken,
    symbol: resolved.symbol,
    baseAsset: resolved.baseAsset,
    quoteAsset: resolved.quoteAsset,
    pricePrecision: resolved.pricePrecision,
    quantityPrecision: resolved.quantityPrecision,
    aliasUsed: !exactMatch,
    suggestions,
  };
}

function formatCompactNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: digits,
  }).format(value);
}

function formatCompactUsd(value, digits = 2) {
  if (!Number.isFinite(value)) return "-";
  const prefix = value >= 0 ? "+" : "-";
  return `${prefix}$${new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: digits,
  }).format(Math.abs(value))}`;
}

function formatCompactUsdAbs(value, digits = 2) {
  if (!Number.isFinite(value)) return "-";
  return `$${new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: digits,
  }).format(Math.abs(value))}`;
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

function formatSigned(value, digits = 2, suffix = "") {
  if (!Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`;
}

function formatTimestamp(timestamp) {
  if (!Number.isFinite(timestamp)) return "-";
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function toneFromNumber(value, flatBand = 0.02) {
  if (!Number.isFinite(value)) return "neutral";
  if (value > flatBand) return "up";
  if (value < -flatBand) return "down";
  return "neutral";
}

function latestDefinedValue(values) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] != null) return values[index];
  }
  return null;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index];
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

function slopePercentage(values, lookback = 10) {
  const filtered = values.filter((value) => value != null);
  if (filtered.length <= lookback) return 0;
  return pctChange(filtered[filtered.length - 1 - lookback], filtered[filtered.length - 1]);
}

function createPill(text, tone) {
  const pill = document.createElement("span");
  pill.className = `pill ${tone}`;
  pill.textContent = text;
  return pill;
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
      createPill(
        `${formatPrice(low, precisionHint)} - ${formatPrice(high, precisionHint)}`,
        tone
      )
    );
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

function renderSetupGrid(setups) {
  dom.setupGrid.innerHTML = "";

  if (!setups.length) {
    const card = document.createElement("article");
    card.className = "setup-card";
    card.innerHTML = `
      <span>Setup engine</span>
      <strong class="neutral">No strong setup</strong>
      <p>Current conditions do not show a high-conviction continuation, squeeze, or fade structure.</p>
      <div class="setup-meta">
        <span>Wait for cleaner flow alignment.</span>
      </div>
    `;
    dom.setupGrid.appendChild(card);
    return;
  }

  setups.forEach((setup) => {
    const card = document.createElement("article");
    card.className = "setup-card";
    card.innerHTML = `
      <span>${setup.label}</span>
      <strong class="${setup.tone}">${setup.stance} • ${setup.confidence}%</strong>
      <p>${setup.summary}</p>
      <div class="setup-meta">
        <span>Trigger: ${setup.trigger}</span>
        <span>Invalidation: ${setup.invalidation}</span>
      </div>
    `;
    dom.setupGrid.appendChild(card);
  });
}

function renderSignalList(signals) {
  dom.signalList.innerHTML = "";
  signals.forEach((signal) => {
    const card = document.createElement("article");
    card.className = "signal-item";
    card.innerHTML = `
      <span>${signal.label}</span>
      <strong class="${signal.tone}">${signal.value}</strong>
      <small>${signal.note}</small>
    `;
    dom.signalList.appendChild(card);
  });
}

function renderTable(container, rows, emptyText) {
  container.innerHTML = "";

  if (!rows.length) {
    const row = document.createElement("div");
    row.className = "table-row";
    row.innerHTML = `
      <div>
        <span>Status</span>
        <strong>${emptyText}</strong>
      </div>
      <div>
        <span>-</span>
        <strong>-</strong>
      </div>
      <div>
        <span>-</span>
        <strong>-</strong>
      </div>
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

function classifyNews(item) {
  const title = `${item.title || ""} ${item.body || ""}`.toLowerCase();
  const bullishWords = [
    "etf",
    "approval",
    "partnership",
    "adoption",
    "inflow",
    "surge",
    "expansion",
  ];
  const bearishWords = [
    "hack",
    "exploit",
    "lawsuit",
    "ban",
    "outflow",
    "crackdown",
    "liquidation",
  ];
  const bullishHits = bullishWords.filter((word) => title.includes(word)).length;
  const bearishHits = bearishWords.filter((word) => title.includes(word)).length;

  if (bullishHits > bearishHits) return "up";
  if (bearishHits > bullishHits) return "down";
  return "neutral";
}

function renderNews(items) {
  dom.newsFeed.innerHTML = "";

  if (!items.length) {
    const article = document.createElement("article");
    article.className = "news-item";
    article.innerHTML = `
      <strong>No high-signal news feed available right now.</strong>
      <span class="news-meta">The perps dashboard can still run on price, leverage, and order-flow data alone.</span>
    `;
    dom.newsFeed.appendChild(article);
    return;
  }

  items.forEach((item) => {
    const tone = classifyNews(item);
    const article = document.createElement("article");
    article.className = "news-item";
    article.innerHTML = `
      <div class="news-meta">
        <span class="pill ${tone}">${tone === "up" ? "Bullish" : tone === "down" ? "Bearish" : "Mixed"}</span>
        <span>${item.source_info?.name || item.source || "Source"}</span>
        <span>${new Date((item.published_on || Date.now() / 1000) * 1000).toLocaleString()}</span>
      </div>
      <a href="${item.url}" target="_blank" rel="noreferrer">
        <strong>${item.title || "Untitled headline"}</strong>
      </a>
      <span>${(item.body || "Headline only.").slice(0, 180)}...</span>
    `;
    dom.newsFeed.appendChild(article);
  });
}

function resizeChart() {
  if (!chart) return;
  chart.applyOptions({
    width: dom.chart.clientWidth,
    height: dom.chart.clientHeight,
  });
}

function initChart() {
  chart = LightweightCharts.createChart(dom.chart, {
    width: dom.chart.clientWidth,
    height: dom.chart.clientHeight,
    layout: {
      background: { color: "#040302" },
      textColor: "#b7ab8e",
      fontFamily:
        '"Prima Sans Mono Std", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
    },
    grid: {
      vertLines: { color: "rgba(176, 135, 54, 0.08)" },
      horzLines: { color: "rgba(176, 135, 54, 0.1)" },
    },
    timeScale: {
      borderColor: "rgba(176, 135, 54, 0.16)",
      timeVisible: true,
    },
    rightPriceScale: {
      borderColor: "rgba(176, 135, 54, 0.16)",
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
    color: "#e1b457",
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });

  ema50LineSeries = chart.addLineSeries({
    color: "#f3dfb1",
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });

  volumeSeries = chart.addHistogramSeries({
    priceFormat: { type: "volume" },
    priceScaleId: "",
    color: "rgba(176, 135, 54, 0.24)",
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

function resetChart() {
  if (chart) {
    try {
      chart.remove();
    } catch (error) {
      console.error("chart reset error", error);
    }
  }

  dom.chart.innerHTML = "";
  chart = null;
  candleSeries = null;
  volumeSeries = null;
  ema20LineSeries = null;
  ema50LineSeries = null;
  priceLines = [];
  initChart();
}

function renderChartTaHud({
  ema20Value = null,
  ema50Value = null,
  rsiValue = null,
  volumeValue = null,
  precision = 2,
} = {}) {
  dom.chartEma20.textContent = ema20Value == null ? "-" : formatPrice(ema20Value, precision);
  dom.chartEma50.textContent = ema50Value == null ? "-" : formatPrice(ema50Value, precision);
  dom.chartRsi.textContent = rsiValue == null ? "-" : rsiValue.toFixed(1);
  dom.chartVolume.textContent = volumeValue == null ? "-" : formatCompactNumber(volumeValue, 2);

  dom.chartEma20.className = toneFromNumber(
    ema20Value == null ? 0 : (state.liveLastPrice || state.liveMarkPrice || 0) - ema20Value,
    0.02
  );
  dom.chartEma50.className = toneFromNumber(
    ema50Value == null ? 0 : (state.liveLastPrice || state.liveMarkPrice || 0) - ema50Value,
    0.02
  );
  dom.chartRsi.className =
    rsiValue == null
      ? "neutral"
      : rsiValue >= 50 && rsiValue <= 70
        ? "up"
        : rsiValue < 45
          ? "down"
          : "neutral";
  dom.chartVolume.className = volumeValue == null ? "neutral" : "up";
}

function syncChartTaSeries(derived) {
  if (!ema20LineSeries || !ema50LineSeries) return;
  ema20LineSeries.setData(derived.ema20LineData);
  ema50LineSeries.setData(derived.ema50LineData);
  renderChartTaHud({
    ema20Value: derived.latestEma20,
    ema50Value: derived.latestEma50,
    rsiValue: derived.latestRsi,
    volumeValue: derived.latestVolume,
    precision: state.snapshot?.pricePrecision || 2,
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

function volumeColor(candle) {
  return candle.close >= candle.open
    ? "rgba(17, 187, 109, 0.4)"
    : "rgba(224, 76, 76, 0.38)";
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
    if (line[index] != null && signalLine[signalIndex] != null) {
      signal[index] = signalLine[signalIndex];
    }
    if (line[index] != null) signalIndex += 1;
  }

  const histogram = line.map((value, index) => {
    if (value == null || signal[index] == null) return null;
    return value - signal[index];
  });

  return { line, signal, histogram };
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

function onBalanceVolume(candles) {
  if (!candles.length) return [];
  const result = [0];

  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1];
    const current = candles[index];
    const delta =
      current.close > previous.close
        ? current.volume
        : current.close < previous.close
          ? -current.volume
          : 0;
    result.push(result[result.length - 1] + delta);
  }

  return result;
}

function vwap(candles) {
  if (!candles.length) return [];
  let cumulativeVolume = 0;
  let cumulativePv = 0;

  return candles.map((candle) => {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativeVolume += candle.volume;
    cumulativePv += typicalPrice * candle.volume;
    return cumulativeVolume === 0 ? null : cumulativePv / cumulativeVolume;
  });
}

function aggregateCandlesBySeconds(candles, bucketSeconds) {
  if (!bucketSeconds) return candles.map((candle) => ({ ...candle }));

  return candles.reduce((buckets, candle) => {
    const bucketTime = Math.floor(candle.time / bucketSeconds) * bucketSeconds;
    const lastBucket = buckets[buckets.length - 1];

    if (!lastBucket || lastBucket.time !== bucketTime) {
      buckets.push({
        time: bucketTime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      });
      return buckets;
    }

    lastBucket.high = Math.max(lastBucket.high, candle.high);
    lastBucket.low = Math.min(lastBucket.low, candle.low);
    lastBucket.close = candle.close;
    lastBucket.volume += candle.volume;
    return buckets;
  }, []);
}

function timeframeBiasDescriptor(score) {
  if (score >= 18) return { label: "Bullish", tone: "up" };
  if (score >= 6) return { label: "Leaning Bullish", tone: "up" };
  if (score <= -18) return { label: "Bearish", tone: "down" };
  if (score <= -6) return { label: "Leaning Bearish", tone: "down" };
  return { label: "Balanced", tone: "neutral" };
}

function timeframeConviction(score) {
  return Math.max(52, Math.min(96, 52 + Math.abs(score) * 2));
}

function summarizeTimeframe(config, candles, precisionHint = 2) {
  const timeframeCandles = config.aggregateSeconds
    ? aggregateCandlesBySeconds(candles, config.aggregateSeconds)
    : candles.map((candle) => ({ ...candle }));

  if (timeframeCandles.length < 60) {
    return {
      key: config.key,
      label: config.label,
      opinion: "Unavailable",
      tone: "neutral",
      conviction: 0,
      changePct: 0,
      latestClose: null,
      latestRsi: null,
      summary: "Not enough candle history to score this timeframe yet.",
      note: "Waiting for more market data",
      pricePrecision: precisionHint,
    };
  }

  const closes = timeframeCandles.map((candle) => candle.close);
  const volumes = timeframeCandles.map((candle) => candle.volume);
  const ema20Series = ema(closes, 20);
  const ema50Series = ema(closes, 50);
  const rsiSeries = rsi(closes, 14);
  const macdSeries = macd(closes);
  const vwapSeries = vwap(timeframeCandles);

  const latestClose = closes[closes.length - 1];
  const latestEma20 = latestDefinedValue(ema20Series) ?? latestClose;
  const latestEma50 = latestDefinedValue(ema50Series) ?? latestClose;
  const latestRsi = latestDefinedValue(rsiSeries) ?? 50;
  const latestMacdHistogram = latestDefinedValue(macdSeries.histogram) ?? 0;
  const latestVwap = latestDefinedValue(vwapSeries) ?? latestClose;
  const changeLookback = Math.max(1, Math.min(8, closes.length - 1));
  const changePctValue = pctChangeFromLookback(closes, changeLookback);
  const averageVolume = average(volumes.slice(-20));
  const volumePulse = averageVolume ? volumes[volumes.length - 1] / averageVolume : 1;

  let score = 0;
  score += latestClose > latestEma20 ? 10 : -10;
  score += latestEma20 > latestEma50 ? 12 : -12;
  score += latestMacdHistogram > 0 ? 8 : -8;
  score += latestClose > latestVwap ? 6 : -6;
  if (latestRsi >= 54 && latestRsi <= 68) score += 8;
  else if (latestRsi < 46) score -= 8;
  else if (latestRsi > 74) score -= 4;
  if (changePctValue > 0) score += 6;
  else if (changePctValue < 0) score -= 6;
  if (volumePulse > 1.15 && changePctValue > 0) score += 4;
  else if (volumePulse > 1.15 && changePctValue < 0) score -= 4;

  const bias = timeframeBiasDescriptor(score);
  const drivers = [
    latestClose > latestEma20 ? "Price above EMA20" : "Price below EMA20",
    latestEma20 > latestEma50 ? "EMA stack constructive" : "EMA stack weak",
    latestMacdHistogram > 0 ? "MACD momentum positive" : "MACD momentum negative",
  ];

  if (latestRsi > 70) drivers.push("RSI stretched");
  else if (latestRsi < 32) drivers.push("RSI washed out");
  else if (latestRsi >= 50) drivers.push("RSI constructive");
  else drivers.push("RSI soft");

  return {
    key: config.key,
    label: config.label,
    opinion: bias.label,
    tone: bias.tone,
    conviction: timeframeConviction(score),
    changePct: changePctValue,
    latestClose,
    latestRsi,
    summary: drivers.slice(0, 3).join(" • "),
    note: latestClose > latestVwap ? "Trading above VWAP" : "Trading below VWAP",
    pricePrecision: precisionHint,
  };
}

function buildTimeframeSummaryCopy(entries) {
  const bullish = entries.filter((entry) => entry.tone === "up").length;
  const bearish = entries.filter((entry) => entry.tone === "down").length;
  const balanced = entries.filter((entry) => entry.tone === "neutral").length;
  const shortTerm = entries.filter((entry) => ["10m", "30m", "1h"].includes(entry.key));
  const longTerm = entries.filter((entry) => ["4h", "1d"].includes(entry.key));
  const shortBullish = shortTerm.filter((entry) => entry.tone === "up").length;
  const longBullish = longTerm.filter((entry) => entry.tone === "up").length;

  if (bullish === entries.length) {
    return `All ${entries.length} tracked timeframes are bullish. Short-horizon momentum and higher-timeframe structure are aligned for continuation unless order flow abruptly deteriorates.`;
  }

  if (bearish === entries.length) {
    return `All ${entries.length} tracked timeframes are bearish. The tape is aligned lower across intraday and swing structure, so upside moves should be treated as reactive until trend conditions improve.`;
  }

  if (shortBullish >= 2 && longBullish === 0) {
    return `${bullish}/${entries.length} timeframes are bullish, but the higher-timeframe structure is still heavy. This usually behaves like a relief bounce unless 4H and 1D trend alignment improves.`;
  }

  if (shortBullish === 0 && longBullish >= 1) {
    return `${bearish}/${entries.length} timeframes are bearish even while the higher-timeframe trend still has support. That mix often creates pullback opportunities rather than full trend failure.`;
  }

  return `${bullish}/${entries.length} timeframes lean bullish, ${bearish}/${entries.length} lean bearish, and ${balanced}/${entries.length} are balanced. Use agreement across 10m, 30m, and 1H for timing, then confirm with 4H and 1D before sizing up.`;
}

function buildTimeframeNarrative(entries) {
  const breakdown = entries
    .map((entry) => `${entry.label} ${entry.opinion.toLowerCase()}`)
    .join(", ");
  return `${breakdown}. ${buildTimeframeSummaryCopy(entries)}`;
}

function renderTimeframeSummary() {
  if (state.timeframeSummaryLoading && !state.timeframeSummary.length) {
    dom.timeframeSummaryCopy.textContent =
      "Scanning 10m, 30m, 1H, 4H, and 1D structure for a concise multi-timeframe read...";
    return;
  }

  if (!state.timeframeSummary.length) {
    dom.timeframeSummaryCopy.textContent =
      "AI multi-timeframe summary will appear here after the contract loads.";
    return;
  }

  dom.timeframeSummaryCopy.textContent = buildTimeframeNarrative(state.timeframeSummary);
}

function computeSupportResistance(candles, currentPrice, latestAtr) {
  const supports = [];
  const resistances = [];
  const lookback = 3;

  for (let index = lookback; index < candles.length - lookback; index += 1) {
    const candle = candles[index];
    const previous = candles.slice(index - lookback, index);
    const next = candles.slice(index + 1, index + 1 + lookback);

    const isSupport =
      previous.every((item) => candle.low <= item.low) &&
      next.every((item) => candle.low <= item.low);
    const isResistance =
      previous.every((item) => candle.high >= item.high) &&
      next.every((item) => candle.high >= item.high);

    if (isSupport) supports.push(candle.low);
    if (isResistance) resistances.push(candle.high);
  }

  const clusterThreshold = Math.max(latestAtr * 0.7, currentPrice * 0.0035);

  function clusterLevels(levels) {
    return levels
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
  }

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
  if (rawTrade.quoteNotional != null) return rawTrade;
  const price = Number(rawTrade.p || rawTrade.price);
  const quantity = Number(rawTrade.q || rawTrade.quantity);
  return {
    price,
    quantity,
    quoteNotional: price * quantity,
    isSellInitiated: Boolean(rawTrade.m ?? rawTrade.isSellInitiated),
    time: Number(rawTrade.T || rawTrade.time || Date.now()),
  };
}

function analyzeTradeTape(trades) {
  const normalizedTrades = trades.map(normalizeTrade);
  if (!normalizedTrades.length) {
    return {
      totalBuyNotional: 0,
      totalSellNotional: 0,
      bigBuyNotional: 0,
      bigSellNotional: 0,
      netLargeFlow: 0,
      bigTradeCount: 0,
      cvdValue: 0,
      cvdSlope: 0,
      latestWhale: null,
    };
  }

  const notionals = normalizedTrades.map((trade) => trade.quoteNotional);
  const whaleCutoff = percentile(notionals, 0.9);
  let cumulativeDelta = 0;
  const cvdSeries = [];
  let latestWhale = null;

  const summary = normalizedTrades.reduce(
    (accumulator, trade) => {
      cumulativeDelta += trade.quoteNotional * (trade.isSellInitiated ? -1 : 1);
      cvdSeries.push(cumulativeDelta);

      if (trade.isSellInitiated) accumulator.totalSellNotional += trade.quoteNotional;
      else accumulator.totalBuyNotional += trade.quoteNotional;

      if (trade.quoteNotional >= whaleCutoff) {
        accumulator.bigTradeCount += 1;
        latestWhale = trade;
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
      bigTradeCount: 0,
    }
  );

  summary.netLargeFlow = summary.bigBuyNotional - summary.bigSellNotional;
  summary.cvdValue = cumulativeDelta;
  summary.cvdSlope = slopePercentage(cvdSeries, 40);
  summary.latestWhale = latestWhale;
  return summary;
}

function analyzeOrderbook(rawDepth, referencePrice) {
  const depth = rawDepth || { bids: [], asks: [] };
  const bids = (depth.bids || []).slice(0, 25).map(([price, quantity]) => ({
    price: Number(price),
    quantity: Number(quantity),
    notional: Number(price) * Number(quantity),
  }));
  const asks = (depth.asks || []).slice(0, 25).map(([price, quantity]) => ({
    price: Number(price),
    quantity: Number(quantity),
    notional: Number(price) * Number(quantity),
  }));

  const bidSum = bids.reduce((sum, level) => sum + level.notional, 0);
  const askSum = asks.reduce((sum, level) => sum + level.notional, 0);
  const imbalance = bidSum + askSum === 0 ? 0 : (bidSum - askSum) / (bidSum + askSum);

  const bidCutoff = percentile(bids.map((level) => level.notional), 0.82);
  const askCutoff = percentile(asks.map((level) => level.notional), 0.82);

  return {
    imbalance,
    bidWalls: bids
      .filter((level) => level.notional >= bidCutoff)
      .sort((left, right) => right.price - left.price)
      .slice(0, 3),
    askWalls: asks
      .filter((level) => level.notional >= askCutoff)
      .sort((left, right) => left.price - right.price)
      .slice(0, 3),
    nearestBidWall: bids[0] || null,
    nearestAskWall: asks[0] || null,
    spreadBps:
      bids[0] && asks[0] && referencePrice
        ? ((asks[0].price - bids[0].price) / referencePrice) * 10000
        : 0,
  };
}

function analyzeTakerLongShort(entries) {
  const parsed = (entries || []).map((entry) => ({
    buySellRatio: Number(entry.buySellRatio),
    buyVol: Number(entry.buyVol),
    sellVol: Number(entry.sellVol),
    timestamp: Number(entry.timestamp),
  }));

  if (!parsed.length) {
    return {
      latestRatio: 1,
      ratioTrend: 0,
      buyVol: 0,
      sellVol: 0,
      netVolume: 0,
    };
  }

  const latest = parsed[parsed.length - 1];
  return {
    latestRatio: latest.buySellRatio,
    ratioTrend: pctChange(parsed[0].buySellRatio, latest.buySellRatio),
    buyVol: latest.buyVol,
    sellVol: latest.sellVol,
    netVolume: latest.buyVol - latest.sellVol,
  };
}

function analyzeForceOrders(forceOrders, currentPrice, latestAtr) {
  const normalized = (forceOrders || []).map((order) => ({
    side: order.side,
    price: Number(order.price),
    quantity: Number(order.quantity),
    notional: Number(order.notional),
    time: Number(order.time),
  }));

  if (!normalized.length) {
    return {
      shortLiquidationNotional: 0,
      longLiquidationNotional: 0,
      netNotional: 0,
      recentOrders: [],
    };
  }

  const summary = normalized.reduce(
    (accumulator, order) => {
      if (order.side === "BUY") accumulator.shortLiquidationNotional += order.notional;
      else accumulator.longLiquidationNotional += order.notional;
      return accumulator;
    },
    {
      shortLiquidationNotional: 0,
      longLiquidationNotional: 0,
    }
  );

  const bucketSize = Math.max(latestAtr * 0.25, currentPrice * 0.0012);
  const clustered = Object.values(
    normalized.reduce((accumulator, order) => {
      const bucketPrice = Math.round(order.price / bucketSize) * bucketSize;
      const key = `${order.side}-${bucketPrice.toFixed(8)}`;
      if (!accumulator[key]) {
        accumulator[key] = {
          side: order.side,
          price: bucketPrice,
          notional: 0,
          count: 0,
          time: order.time,
        };
      }
      accumulator[key].notional += order.notional;
      accumulator[key].count += 1;
      accumulator[key].time = Math.max(accumulator[key].time, order.time);
      return accumulator;
    }, {})
  )
    .sort((left, right) => right.notional - left.notional)
    .slice(0, 3)
    .map((cluster) => ({
      side: cluster.side,
      price: cluster.price,
      notional: cluster.notional,
      count: cluster.count,
      time: cluster.time,
    }));

  return {
    shortLiquidationNotional: summary.shortLiquidationNotional,
    longLiquidationNotional: summary.longLiquidationNotional,
    netNotional: summary.shortLiquidationNotional - summary.longLiquidationNotional,
    recentOrders: [...clustered, ...normalized.slice(-5).reverse()].slice(0, 8),
  };
}

function marketRegimeLabel(btcChange, ethChange) {
  if (btcChange > 0 && ethChange > 0) return { label: "Risk-On", tone: "up" };
  if (btcChange < 0 && ethChange < 0) return { label: "Risk-Off", tone: "down" };
  return { label: "Mixed Tape", tone: "neutral" };
}

function buildBiasScore(context) {
  const takerSummary = context.takerSummary || {
    latestRatio: 1,
  };
  let score = 0;

  if (context.currentPrice > context.ema20) score += 12;
  else score -= 12;

  if (context.ema20 > context.ema50) score += 15;
  else score -= 15;

  if (context.latestRsi >= 52 && context.latestRsi <= 68) score += 8;
  else if (context.latestRsi < 44) score -= 10;
  else if (context.latestRsi > 75) score -= 6;

  if (context.latestMacdHistogram > 0) score += 10;
  else score -= 10;

  if (context.tradeSummary.cvdSlope > 0) score += 12;
  else score -= 12;

  if (context.depthSummary.imbalance > 0.04) score += 9;
  else if (context.depthSummary.imbalance < -0.04) score -= 9;

  if (context.oiChange1h > 0) score += 7;
  else score -= 7;

  if (takerSummary.latestRatio > 1.03) score += 8;
  else if (takerSummary.latestRatio < 0.97) score -= 8;

  if (context.fundingRate > 0 && context.fundingRate < 0.03) score += 5;
  else if (context.fundingRate >= 0.03) score -= 5;
  else if (context.fundingRate < 0) score -= 4;

  if (context.globalLongShortRatio > 1.05) score += 4;
  else if (context.globalLongShortRatio < 0.95) score -= 4;

  if (context.newsScore > 0) score += Math.min(context.newsScore * 3, 9);
  if (context.newsScore < 0) score += Math.max(context.newsScore * 3, -9);

  if (context.btcChange > 0 && context.ethChange > 0) score += 4;
  else if (context.btcChange < 0 && context.ethChange < 0) score -= 4;

  return Math.max(-100, Math.min(100, Math.round(score)));
}

function biasDescriptor(score) {
  if (score >= 35) return { label: "Bullish", tone: "up" };
  if (score >= 10) return { label: "Slightly Bullish", tone: "up" };
  if (score <= -35) return { label: "Bearish", tone: "down" };
  if (score <= -10) return { label: "Slightly Bearish", tone: "down" };
  return { label: "Balanced", tone: "neutral" };
}

function confidenceScore(score) {
  return Math.max(10, Math.min(95, Math.round(score)));
}

function buildTradeSetups(context) {
  const takerSummary = context.takerSummary || {
    latestRatio: 1,
  };
  const support = context.supportLevels[0];
  const resistance = context.resistanceLevels[0];
  const vwapLevel = context.latestVwap || context.currentPrice;

  const continuationLong = confidenceScore(
    25 +
      (context.currentPrice > context.ema20 ? 14 : -8) +
      (context.ema20 > context.ema50 ? 14 : -12) +
      (context.tradeSummary.cvdSlope > 0 ? 12 : -10) +
      (context.depthSummary.imbalance > 0 ? 10 : -8) +
      (context.oiChange1h > 0 ? 8 : -6) +
      (takerSummary.latestRatio > 1 ? 8 : -6) +
      (context.latestRsi < 72 ? 6 : -4)
  );

  const continuationShort = confidenceScore(
    25 +
      (context.currentPrice < context.ema20 ? 14 : -8) +
      (context.ema20 < context.ema50 ? 14 : -12) +
      (context.tradeSummary.cvdSlope < 0 ? 12 : -10) +
      (context.depthSummary.imbalance < 0 ? 10 : -8) +
      (context.oiChange1h > 0 ? 8 : -4) +
      (takerSummary.latestRatio < 1 ? 8 : -6) +
      (context.latestRsi > 28 ? 5 : -5)
  );

  const shortSqueezeLong = confidenceScore(
    22 +
      (context.fundingRate < 0 ? 16 : -6) +
      (context.oiChange1h > 0 ? 12 : -6) +
      (context.tradeSummary.cvdSlope > 0 ? 12 : -8) +
      (context.forceSummary.shortLiquidationNotional > context.forceSummary.longLiquidationNotional
        ? 10
        : -4) +
      (context.currentPrice > vwapLevel ? 8 : -6) +
      (context.topLongShortRatio < 1 ? 10 : -4)
  );

  const longSqueezeShort = confidenceScore(
    22 +
      (context.fundingRate > 0 ? 14 : -8) +
      (context.oiChange1h > 0 ? 10 : -4) +
      (context.tradeSummary.cvdSlope < 0 ? 12 : -8) +
      (context.forceSummary.longLiquidationNotional > context.forceSummary.shortLiquidationNotional
        ? 10
        : -4) +
      (context.currentPrice < vwapLevel ? 8 : -6) +
      (context.topLongShortRatio > 1 ? 8 : -4)
  );

  const meanReversion = confidenceScore(
    20 +
      (context.bias.label === "Balanced" ? 18 : 0) +
      (Math.abs(context.depthSummary.imbalance) < 0.03 ? 10 : -4) +
      (Math.abs(context.tradeSummary.cvdSlope) < 8 ? 8 : -4) +
      (context.latestRsi > 66 || context.latestRsi < 34 ? 12 : -6) +
      (Math.abs(context.oiChange1h) < 2 ? 8 : -6)
  );

  return [
    {
      label: "Breakout Continuation",
      stance: "Long bias",
      confidence: continuationLong,
      tone: "up",
      summary:
        "Trend, CVD, and order-book pressure are aligned for upside continuation if price keeps accepting above fast trend support.",
      trigger: resistance
        ? `Acceptance above ${formatPrice(resistance, context.pricePrecision)}`
        : `Hold above EMA20 ${formatPrice(context.ema20, context.pricePrecision)}`,
      invalidation: support
        ? `Loss of ${formatPrice(support, context.pricePrecision)}`
        : `Loss of VWAP ${formatPrice(vwapLevel, context.pricePrecision)}`,
    },
    {
      label: "Trend Breakdown",
      stance: "Short bias",
      confidence: continuationShort,
      tone: "down",
      summary:
        "Price is vulnerable to downside continuation when asks stay heavy and CVD cannot reclaim positive momentum.",
      trigger: support
        ? `Acceptance below ${formatPrice(support, context.pricePrecision)}`
        : `Reject at EMA20 ${formatPrice(context.ema20, context.pricePrecision)}`,
      invalidation: resistance
        ? `Reclaim ${formatPrice(resistance, context.pricePrecision)}`
        : `Reclaim VWAP ${formatPrice(vwapLevel, context.pricePrecision)}`,
    },
    {
      label: "Short Squeeze",
      stance: "Long squeeze reversal",
      confidence: shortSqueezeLong,
      tone: "up",
      summary:
        "Negative funding with expanding OI can fuel an upside squeeze if aggressive buying forces shorts to cover into resistance.",
      trigger: `Funding stays below 0 and price holds ${formatPrice(vwapLevel, context.pricePrecision)}`,
      invalidation: support
        ? `Lose ${formatPrice(support, context.pricePrecision)}`
        : "Lose the intraday base",
    },
    {
      label: "Long Squeeze",
      stance: "Short squeeze reversal",
      confidence: longSqueezeShort,
      tone: "down",
      summary:
        "Crowded longs become fragile when price loses VWAP and liquidation flow starts hitting long positioning on the bid.",
      trigger: `Price rejects ${formatPrice(vwapLevel, context.pricePrecision)} with positive funding`,
      invalidation: resistance
        ? `Break above ${formatPrice(resistance, context.pricePrecision)}`
        : "Sustain above the current swing high",
    },
    {
      label: "Range Fade",
      stance: "Mean reversion",
      confidence: meanReversion,
      tone: "neutral",
      summary:
        "When leverage expansion is muted and book pressure is balanced, extremes into support or resistance are better faded than chased.",
      trigger:
        support && resistance
          ? `Fade ${formatPrice(support, context.pricePrecision)} / ${formatPrice(resistance, context.pricePrecision)} extremes`
          : "Fade stretched RSI moves back toward VWAP",
      invalidation: "Strong breakout with OI and CVD confirmation",
    },
  ]
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 3);
}

function buildOutlook(context) {
  const support = context.supportLevels[0];
  const resistance = context.resistanceLevels[0];

  const structureText =
    context.bias.label === "Bullish" || context.bias.label === "Slightly Bullish"
      ? `${formatPrice(context.currentPrice, context.pricePrecision)} is trading with constructive futures structure. The clean long continuation path is a hold above ${support ? formatPrice(support, context.pricePrecision) : "nearby support"} and acceptance into ${resistance ? formatPrice(resistance, context.pricePrecision) : "fresh highs"}.`
      : context.bias.label === "Bearish" || context.bias.label === "Slightly Bearish"
        ? `${formatPrice(context.currentPrice, context.pricePrecision)} is trading with weak futures structure. If price keeps failing below ${resistance ? formatPrice(resistance, context.pricePrecision) : "intraday resistance"}, the next 5H to 24H window favors pressure into ${support ? formatPrice(support, context.pricePrecision) : "lower support"}.`
        : `${formatPrice(context.currentPrice, context.pricePrecision)} is in a balanced intraday regime. The next 5H to 24H likely remains range-based unless price breaks ${resistance ? formatPrice(resistance, context.pricePrecision) : "resistance"} or loses ${support ? formatPrice(support, context.pricePrecision) : "support"} with leverage confirmation.`;

  const leverageText =
    context.fundingRate < 0 && context.oiChange1h > 0
      ? "Negative funding with growing OI means shorts are paying to stay in, which can become squeeze fuel if CVD stays positive."
      : context.fundingRate > 0 && context.oiChange1h > 0
        ? "Positive funding with rising OI means longs are building, which supports continuation only while order-book demand stays firm."
        : "Leverage is not yet one-sided enough to dominate the tape, so price structure and CVD should lead the read.";

  const tapeText =
    context.tradeSummary.cvdSlope > 0
      ? `CVD is rising and taker flow is leaning buyer-led at ${context.takerSummary.latestRatio.toFixed(2)}.`
      : `CVD is falling and taker flow is leaning seller-led at ${context.takerSummary.latestRatio.toFixed(2)}.`;

  const liquidationText =
    context.forceSummary.shortLiquidationNotional > context.forceSummary.longLiquidationNotional
      ? "Recent forced orders are skewing toward shorts getting squeezed, which can extend momentum but also create chase risk."
      : context.forceSummary.longLiquidationNotional > context.forceSummary.shortLiquidationNotional
        ? "Recent forced orders are skewing toward long liquidations, which keeps downside pressure active until that flush stabilizes."
        : "Liquidation flow is currently light, so squeeze dynamics are present but not yet dominant.";

  return `${structureText} ${leverageText} ${tapeText} ${liquidationText}`;
}

function buildPotentialTrade(context) {
  const supportLevels = [...context.supportLevels].filter(Boolean).sort((left, right) => right - left);
  const resistanceLevels = [...context.resistanceLevels]
    .filter(Boolean)
    .sort((left, right) => left - right);
  const directionalSetup =
    context.setups.find((setup) => setup.tone === "up" || setup.tone === "down") ||
    context.setups[0] ||
    null;
  const tone =
    directionalSetup?.tone === "down" || context.bias.label.includes("Bearish") ? "down" : "up";
  const stance = tone === "down" ? "Short" : "Long";
  const entry = context.currentPrice;
  const riskUnit = Math.max(context.latestAtr * 0.9, context.currentPrice * 0.006);
  const bandBuffer = Math.max(context.bandWidth || 0, riskUnit * 0.18);

  let stopLoss;
  let takeProfit1;
  let takeProfit2;

  if (tone === "up") {
    const nearestSupport = supportLevels.find((level) => level < entry) ?? entry - riskUnit;
    const nearestResistance =
      resistanceLevels.find((level) => level > entry) ?? entry + riskUnit * 1.15;
    const secondResistance =
      resistanceLevels.find((level) => level > nearestResistance + bandBuffer) ??
      Math.max(nearestResistance + riskUnit, entry + riskUnit * 2);

    stopLoss = Math.min(nearestSupport - bandBuffer, entry - riskUnit * 0.9);
    takeProfit1 = Math.max(nearestResistance, entry + riskUnit * 0.9);
    takeProfit2 = Math.max(secondResistance, takeProfit1 + riskUnit * 0.8);
  } else {
    const nearestResistance =
      resistanceLevels.find((level) => level > entry) ?? entry + riskUnit;
    const nearestSupport = supportLevels.find((level) => level < entry) ?? entry - riskUnit * 1.15;
    const secondSupport =
      supportLevels.find((level) => level < nearestSupport - bandBuffer) ??
      Math.min(nearestSupport - riskUnit, entry - riskUnit * 2);

    stopLoss = Math.max(nearestResistance + bandBuffer, entry + riskUnit * 0.9);
    takeProfit1 = Math.min(nearestSupport, entry - riskUnit * 0.9);
    takeProfit2 = Math.min(secondSupport, takeProfit1 - riskUnit * 0.8);
  }

  const summary =
    tone === "up"
      ? `${directionalSetup?.label || "Momentum continuation"} favors a long while price holds above local support. Scale partials into TP1 and let TP2 ride only if order flow stays constructive.`
      : `${directionalSetup?.label || "Trend pressure"} favors a short while price stays capped under resistance. Pay yourself at TP1 and only press for TP2 if sellers keep control of tape and leverage.`;

  return {
    stance,
    tone,
    entry,
    takeProfit1,
    takeProfit2,
    stopLoss,
    summary,
  };
}

function renderPotentialTrade(trade, precisionHint = 2) {
  if (!trade) {
    dom.tradeStance.textContent = "Waiting";
    dom.tradeStance.className = "pill neutral";
    dom.tradeEntry.textContent = "-";
    dom.tradeEntry.className = "";
    dom.tradeTp1.textContent = "-";
    dom.tradeTp1.className = "";
    dom.tradeTp2.textContent = "-";
    dom.tradeTp2.className = "";
    dom.tradeSl.textContent = "-";
    dom.tradeSl.className = "";
    dom.tradeSummary.textContent = "AI trade setup will appear here once the token is loaded.";
    setTradeRefreshNote("Auto refresh every 15m");
    return;
  }

  dom.tradeStance.textContent = trade.stance;
  dom.tradeStance.className = `pill ${trade.tone}`;
  dom.tradeEntry.textContent = formatPrice(trade.entry, precisionHint);
  dom.tradeEntry.className = trade.tone === "up" ? "up" : "down";
  dom.tradeTp1.textContent = formatPrice(trade.takeProfit1, precisionHint);
  dom.tradeTp1.className = trade.tone === "up" ? "up" : "down";
  dom.tradeTp2.textContent = formatPrice(trade.takeProfit2, precisionHint);
  dom.tradeTp2.className = trade.tone === "up" ? "up" : "down";
  dom.tradeSl.textContent = formatPrice(trade.stopLoss, precisionHint);
  dom.tradeSl.className = trade.tone === "up" ? "down" : "up";
  dom.tradeSummary.textContent = trade.summary;
}

function renderEmptyDashboard(message) {
  removePriceLines();
  candleSeries.setData([]);
  volumeSeries.setData([]);
  ema20LineSeries.setData([]);
  ema50LineSeries.setData([]);
  renderChartTaHud();
  dom.assetTitle.textContent = "Perpetual contract";
  dom.assetSubtitle.textContent = message;
  dom.headlinePrice.textContent = "-";
  dom.headlineChange.textContent = "-";
  dom.headlineChange.className = "neutral";
  dom.headlineBias.textContent = "-";
  dom.headlineBias.className = "neutral";
  dom.biasScore.textContent = "0";
  dom.biasScore.className = "score-badge neutral";
  dom.outlookSummary.textContent = message;
  renderLevelBands(dom.supportFields, [], 0, "up", 2);
  renderLevelBands(dom.resistanceFields, [], 0, "down", 2);
  renderSignalList([
    {
      label: "Status",
      value: "Waiting for a valid perp",
      note: message,
      tone: "neutral",
    },
  ]);
  renderAnalysisGrid(dom.taGrid, []);
  renderAnalysisGrid(dom.flowGrid, []);
  renderAnalysisGrid(dom.fundingGrid, []);
  renderSetupGrid([]);
  renderTable(dom.flowTable, [], "No live flow loaded");
  renderTable(dom.depthTable, [], "No order-book data");
  renderTable(dom.liquidationTable, [], "No liquidation tape");
  renderNews([]);
  renderTimeframeSummary();
  renderPotentialTrade(null);

  [
    dom.metricVolume,
    dom.metricImbalance,
    dom.metricCvd,
    dom.metricFunding,
    dom.metricOi,
    dom.metricLiq,
  ].forEach((element) => {
    element.textContent = "-";
    element.className = "neutral";
  });
}

async function fetchSnapshot(token, interval) {
  const requestUrl = new URL("/api/market", window.location.origin);
  requestUrl.searchParams.set("token", normalizeToken(token));
  requestUrl.searchParams.set("interval", interval);

  try {
    const response = await fetch(requestUrl);
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const suggestions =
        Array.isArray(payload.suggestions) && payload.suggestions.length
          ? ` Try ${payload.suggestions.join(", ")}.`
          : "";
      throw new Error(`${payload.error || "Failed to load perp snapshot."}${suggestions}`);
    }

    return {
      ...payload,
      dataSource: "server",
    };
  } catch (error) {
    setStatus(
      "Server-side exchange access is blocked for this region. Falling back to direct browser data...",
      "neutral"
    );
    setStreamStatus("Switching to browser-side data path", "neutral");
    return fetchDirectSnapshot(token, interval);
  }
}

async function fetchDirectJson(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status})`);
  }
  return response.json();
}

async function fetchDirectSnapshot(token, interval) {
  const exchangeInfo = await fetchDirectJson(
    "https://fapi.binance.com/fapi/v1/exchangeInfo",
    "Futures exchange info"
  );

  const resolved = resolvePerpSymbolFromExchangeInfo(token, exchangeInfo);
  const newsCategories = Array.from(
    new Set([
      newsCategoryToken(resolved.cleanedToken),
      newsCategoryToken(resolved.baseAsset),
      "BTC",
      "ETH",
      "Regulation",
      "Blockchain",
    ])
  ).join(",");

  const requests = await Promise.allSettled([
    fetchDirectJson(
      `https://fapi.binance.com/fapi/v1/klines?symbol=${resolved.symbol}&interval=${interval}&limit=240`,
      "Perps klines"
    ),
    fetchDirectJson(
      `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${resolved.symbol}`,
      "Perps 24H ticker"
    ),
    fetchDirectJson(
      `https://fapi.binance.com/fapi/v1/depth?symbol=${resolved.symbol}&limit=100`,
      "Perps orderbook"
    ),
    fetchDirectJson(
      `https://fapi.binance.com/fapi/v1/aggTrades?symbol=${resolved.symbol}&limit=400`,
      "Perps agg trades"
    ),
    fetchDirectJson(
      `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${resolved.symbol}`,
      "Premium index"
    ),
    fetchDirectJson(
      `https://fapi.binance.com/fapi/v1/openInterest?symbol=${resolved.symbol}`,
      "Open interest"
    ),
    fetchDirectJson(
      `https://fapi.binance.com/futures/data/openInterestHist?symbol=${resolved.symbol}&period=5m&limit=60`,
      "Open interest history"
    ),
    fetchDirectJson(
      `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${resolved.symbol}&period=1h&limit=24`,
      "Global long short ratio"
    ),
    fetchDirectJson(
      `https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${resolved.symbol}&period=1h&limit=24`,
      "Top trader long short ratio"
    ),
    fetchDirectJson(
      `https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${resolved.symbol}&period=5m&limit=24`,
      "Taker long short ratio"
    ),
    fetchDirectJson(
      "https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT",
      "BTC context"
    ),
    fetchDirectJson(
      "https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=ETHUSDT",
      "ETH context"
    ),
    fetchDirectJson(
      `https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=${newsCategories}&excludeCategories=Sponsored`,
      "News"
    ),
  ]);

  const [
    klinesResult,
    tickerResult,
    depthResult,
    tradesResult,
    premiumIndexResult,
    openInterestResult,
    openInterestHistoryResult,
    globalLongShortResult,
    topLongShortResult,
    takerLongShortResult,
    btcContextResult,
    ethContextResult,
    newsResult,
  ] = requests;

  if (klinesResult.status !== "fulfilled" || tickerResult.status !== "fulfilled") {
    throw new Error(`Core perpetual market data is unavailable for ${resolved.symbol}.`);
  }

  return {
    token: resolved.cleanedToken,
    symbol: resolved.symbol,
    baseAsset: resolved.baseAsset,
    quoteAsset: resolved.quoteAsset,
    pricePrecision: resolved.pricePrecision,
    quantityPrecision: resolved.quantityPrecision,
    aliasUsed: resolved.aliasUsed,
    suggestions: resolved.suggestions,
    interval,
    fetchedAt: Date.now(),
    candles: klinesResult.value.map(mapKlineEntry),
    ticker: tickerResult.value,
    depth: depthResult.status === "fulfilled" ? depthResult.value : { bids: [], asks: [] },
    trades: tradesResult.status === "fulfilled" ? tradesResult.value : [],
    premiumIndex: premiumIndexResult.status === "fulfilled" ? premiumIndexResult.value : null,
    openInterest: openInterestResult.status === "fulfilled" ? openInterestResult.value : null,
    openInterestHistory:
      openInterestHistoryResult.status === "fulfilled"
        ? openInterestHistoryResult.value
        : [],
    globalLongShort:
      globalLongShortResult.status === "fulfilled" ? globalLongShortResult.value : [],
    topLongShort:
      topLongShortResult.status === "fulfilled" ? topLongShortResult.value : [],
    takerLongShort:
      takerLongShortResult.status === "fulfilled" ? takerLongShortResult.value : [],
    context: {
      btcTicker: btcContextResult.status === "fulfilled" ? btcContextResult.value : null,
      ethTicker: ethContextResult.status === "fulfilled" ? ethContextResult.value : null,
    },
    news:
      newsResult.status === "fulfilled" && Array.isArray(newsResult.value.Data)
        ? newsResult.value.Data.slice(0, 6)
        : [],
    dataSource: "browser",
  };
}

async function fetchTimeframeSummary(symbol, selectedInterval, selectedCandles, precisionHint) {
  const cache = new Map();

  async function loadCandles(interval) {
    if (interval === selectedInterval && Array.isArray(selectedCandles) && selectedCandles.length) {
      return selectedCandles.map((candle) => ({ ...candle }));
    }

    if (!cache.has(interval)) {
      cache.set(
        interval,
        fetchDirectJson(
          `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${TIMEFRAME_FETCH_LIMIT}`,
          `${interval} timeframe`
        ).then((entries) => entries.map(mapKlineEntry))
      );
    }

    return cache.get(interval);
  }

  const results = await Promise.allSettled(
    TIMEFRAME_SUMMARY_CONFIG.map(async (config) =>
      summarizeTimeframe(config, await loadCandles(config.fetchInterval), precisionHint)
    )
  );

  return results.map((result, index) => {
    if (result.status === "fulfilled") return result.value;

    const config = TIMEFRAME_SUMMARY_CONFIG[index];
    return {
      key: config.key,
      label: config.label,
      opinion: "Unavailable",
      tone: "neutral",
      conviction: 0,
      changePct: 0,
      latestClose: null,
      latestRsi: null,
      summary: "Unable to fetch this timeframe right now.",
      note: "Data request failed",
      pricePrecision: precisionHint,
    };
  });
}

async function refreshTimeframeSummary(requestId, snapshot, interval) {
  state.timeframeSummaryLoading = true;

  try {
    const summary = await fetchTimeframeSummary(
      snapshot.symbol,
      interval,
      snapshot.candles || [],
      snapshot.pricePrecision || 2
    );

    if (requestId !== state.requestId) return;
    state.timeframeSummary = summary;
  } catch (error) {
    if (requestId !== state.requestId) return;
    state.timeframeSummary = [];
    console.error("timeframe summary error", error);
  } finally {
    if (requestId !== state.requestId) return;
    state.timeframeSummaryLoading = false;
    renderDashboard();
  }
}

function primeState(snapshot) {
  state.snapshot = snapshot;
  state.candles = (snapshot.candles || []).map((candle) => ({ ...candle }));
  state.tradeHistory = (snapshot.trades || [])
    .map(normalizeTrade)
    .slice(-MAX_TRADE_SAMPLES);
  state.forceOrders = [];
  state.liveDepth = snapshot.depth || { bids: [], asks: [] };
  state.liveMarkPrice = Number(snapshot.premiumIndex?.markPrice) || null;
  state.liveIndexPrice = Number(snapshot.premiumIndex?.indexPrice) || null;
  state.liveFundingRate = Number(snapshot.premiumIndex?.lastFundingRate) * 100 || null;
  state.liveNextFundingTime = Number(snapshot.premiumIndex?.nextFundingTime) || null;
  state.liveLastPrice = state.candles[state.candles.length - 1]?.close || null;

  candleSeries.setData(state.candles);
  volumeSeries.setData(
    state.candles.map((candle) => ({
      time: candle.time,
      value: candle.volume,
      color: volumeColor(candle),
    }))
  );
  chart.priceScale("right").applyOptions({
    autoScale: true,
  });
  chart.timeScale().fitContent();
  resizeChart();
}

function buildDerivedState() {
  const snapshot = state.snapshot;
  const candles = state.candles;
  const closes = candles.map((candle) => candle.close);
  const currentPrice =
    state.liveMarkPrice || state.liveLastPrice || closes[closes.length - 1] || 0;

  const ema20Series = ema(closes, 20);
  const ema50Series = ema(closes, 50);
  const rsiSeries = rsi(closes, 14);
  const macdSeries = macd(closes);
  const atrSeries = atr(candles, 14);
  const obvSeries = onBalanceVolume(candles);
  const vwapSeries = vwap(candles);

  const latestEma20 = latestDefinedValue(ema20Series) ?? currentPrice;
  const latestEma50 = latestDefinedValue(ema50Series) ?? currentPrice;
  const latestRsi = latestDefinedValue(rsiSeries) ?? 50;
  const latestMacdHistogram = latestDefinedValue(macdSeries.histogram) ?? 0;
  const latestAtr = latestDefinedValue(atrSeries) ?? currentPrice * 0.01;
  const latestVwap = latestDefinedValue(vwapSeries) ?? currentPrice;
  const obvSlope = slopePercentage(obvSeries, 12);
  const latestVolume = candles[candles.length - 1]?.volume ?? 0;
  const ema20LineData = candles
    .map((candle, index) =>
      ema20Series[index] == null ? null : { time: candle.time, value: ema20Series[index] }
    )
    .filter(Boolean);
  const ema50LineData = candles
    .map((candle, index) =>
      ema50Series[index] == null ? null : { time: candle.time, value: ema50Series[index] }
    )
    .filter(Boolean);

  const tradeSummary = analyzeTradeTape(state.tradeHistory);
  const depthSummary = analyzeOrderbook(state.liveDepth, currentPrice);
  const supportResistance = computeSupportResistance(candles, currentPrice, latestAtr);
  const takerSummary = analyzeTakerLongShort(snapshot.takerLongShort);
  const forceSummary = analyzeForceOrders(state.forceOrders, currentPrice, latestAtr);

  const fundingRate =
    Number.isFinite(state.liveFundingRate)
      ? state.liveFundingRate
      : Number(snapshot.premiumIndex?.lastFundingRate) * 100 || 0;
  const indexPrice =
    Number.isFinite(state.liveIndexPrice)
      ? state.liveIndexPrice
      : Number(snapshot.premiumIndex?.indexPrice) || currentPrice;
  const markPrice =
    Number.isFinite(state.liveMarkPrice)
      ? state.liveMarkPrice
      : Number(snapshot.premiumIndex?.markPrice) || currentPrice;
  const annualizedFunding = (fundingRate / 100) * 3 * 365 * 100;
  const markPremium = pctChange(indexPrice, markPrice);

  const oiHistory = (snapshot.openInterestHistory || []).map((entry) =>
    Number(entry.sumOpenInterest)
  );
  const oiNow =
    Number(snapshot.openInterest?.openInterest) ||
    oiHistory[oiHistory.length - 1] ||
    0;
  const oiChange1h = pctChangeFromLookback(oiHistory, 12);
  const oiChange4h = pctChangeFromLookback(oiHistory, 48);
  const oiTrend =
    oiHistory.length > 1 ? pctChange(oiHistory[0], oiHistory[oiHistory.length - 1]) : 0;

  const globalLongShortRatio =
    snapshot.globalLongShort?.length
      ? Number(snapshot.globalLongShort[snapshot.globalLongShort.length - 1].longShortRatio)
      : 1;
  const topLongShortRatio =
    snapshot.topLongShort?.length
      ? Number(snapshot.topLongShort[snapshot.topLongShort.length - 1].longShortRatio)
      : 1;

  const btcChange = Number(snapshot.context?.btcTicker?.priceChangePercent) || 0;
  const ethChange = Number(snapshot.context?.ethTicker?.priceChangePercent) || 0;
  const regime = marketRegimeLabel(btcChange, ethChange);

  const newsItems = snapshot.news || [];
  const newsScore = newsItems.reduce((score, item) => {
    const tone = classifyNews(item);
    if (tone === "up") return score + 1;
    if (tone === "down") return score - 1;
    return score;
  }, 0);

  const biasScore = buildBiasScore({
    currentPrice,
    ema20: latestEma20,
    ema50: latestEma50,
    latestRsi,
    latestMacdHistogram,
    tradeSummary,
    depthSummary,
    oiChange1h,
    takerSummary,
    fundingRate,
    globalLongShortRatio,
    newsScore,
    btcChange,
    ethChange,
  });
  const bias = biasDescriptor(biasScore);
  const setups = buildTradeSetups({
    currentPrice,
    ema20: latestEma20,
    ema50: latestEma50,
    latestRsi,
    latestVwap,
    fundingRate,
    tradeSummary,
    depthSummary,
    takerSummary,
    oiChange1h,
    topLongShortRatio,
    supportLevels: supportResistance.supportLevels,
    resistanceLevels: supportResistance.resistanceLevels,
    forceSummary,
    bias,
    pricePrecision: snapshot.pricePrecision,
  });
  const potentialTrade = buildPotentialTrade({
    currentPrice,
    latestAtr,
    bandWidth: supportResistance.bandWidth,
    supportLevels: supportResistance.supportLevels,
    resistanceLevels: supportResistance.resistanceLevels,
    bias,
    setups,
  });

  return {
    currentPrice,
    priceChange24h: Number(snapshot.ticker?.priceChangePercent) || 0,
    latestEma20,
    latestEma50,
    latestRsi,
    latestMacdHistogram,
    latestAtr,
    latestVwap,
    latestVolume,
    obvSlope,
    ema20LineData,
    ema50LineData,
    tradeSummary,
    depthSummary,
    supportResistance,
    fundingRate,
    annualizedFunding,
    markPrice,
    indexPrice,
    markPremium,
    oiNow,
    oiChange1h,
    oiChange4h,
    oiTrend,
    globalLongShortRatio,
    topLongShortRatio,
    takerSummary,
    btcChange,
    ethChange,
    regime,
    newsItems,
    newsScore,
    biasScore,
    bias,
    forceSummary,
    setups,
    potentialTrade,
    nextFundingTime: Number.isFinite(state.liveNextFundingTime)
      ? state.liveNextFundingTime
      : Number(snapshot.premiumIndex?.nextFundingTime) || 0,
  };
}

function updateStreamBadge() {
  if (!state.streams.length) {
    setStreamStatus("Live feeds offline", "down");
    return;
  }

  const connected = state.streams.filter((stream) => stream.connected).length;
  const tone =
    connected === state.streams.length ? "up" : connected > 0 ? "neutral" : "down";
  setStreamStatus(`${connected}/${state.streams.length} live feeds connected`, tone);
}

function scheduleRender() {
  if (state.renderTimer || !state.snapshot) return;
  state.renderTimer = window.setTimeout(() => {
    state.renderTimer = null;
    renderDashboard();
  }, RENDER_THROTTLE_MS);
}

function clearRenderTimer() {
  if (!state.renderTimer) return;
  window.clearTimeout(state.renderTimer);
  state.renderTimer = null;
}

function clearTradeRefreshTimer() {
  if (!state.tradeRefreshTimer) return;
  window.clearTimeout(state.tradeRefreshTimer);
  state.tradeRefreshTimer = null;
}

function scheduleTradeAutoRefresh() {
  clearTradeRefreshTimer();
  state.tradeRefreshTimer = window.setTimeout(() => {
    if (!state.activeToken || !state.activeInterval) return;
    setTradeRefreshNote("Refreshing trade setup...");
    loadDashboard(state.activeToken, state.activeInterval);
  }, TRADE_AUTO_REFRESH_MS);
}

function renderDashboard() {
  if (!state.snapshot) return;

  const snapshot = state.snapshot;
  const derived = buildDerivedState();
  const precision = snapshot.pricePrecision || 2;

  removePriceLines();
  derived.supportResistance.supportLevels.forEach((level, index) => {
    addLevelLine(level, `S${index + 1}`, "#0d8f54");
  });
  derived.supportResistance.resistanceLevels.forEach((level, index) => {
    addLevelLine(level, `R${index + 1}`, "#c23a3a");
  });
  syncChartTaSeries(derived);

  dom.assetTitle.textContent = `${snapshot.symbol} Perpetual`;
  dom.assetSubtitle.textContent = snapshot.aliasUsed
    ? `Resolved ${snapshot.token} to ${snapshot.symbol} on Binance USDT perpetuals`
    : `Binance USDT perpetual • ${snapshot.baseAsset}`;

  dom.headlinePrice.textContent = formatPrice(derived.currentPrice, precision);
  dom.headlineChange.textContent = formatPercent(derived.priceChange24h);
  dom.headlineChange.className = toneFromNumber(derived.priceChange24h, 0.15);
  dom.headlineBias.textContent = derived.bias.label;
  dom.headlineBias.className = derived.bias.tone;

  dom.biasScore.textContent = `${derived.biasScore}`;
  dom.biasScore.className = `score-badge ${derived.bias.tone}`;
  dom.outlookSummary.textContent = buildOutlook({
    ...derived,
    supportLevels: derived.supportResistance.supportLevels,
    resistanceLevels: derived.supportResistance.resistanceLevels,
    pricePrecision: precision,
  });

  renderLevelBands(
    dom.supportFields,
    derived.supportResistance.supportLevels,
    derived.supportResistance.bandWidth,
    "up",
    precision
  );
  renderLevelBands(
    dom.resistanceFields,
    derived.supportResistance.resistanceLevels,
    derived.supportResistance.bandWidth,
    "down",
    precision
  );
  renderPotentialTrade(derived.potentialTrade, precision);

  dom.metricVolume.textContent = formatCompactNumber(Number(snapshot.ticker?.quoteVolume) || 0);
  dom.metricVolume.className = toneFromNumber(derived.priceChange24h, 0.15);
  dom.metricVolumeNote.textContent = `24H perp quote volume • ${formatCompactNumber(Number(snapshot.ticker?.volume) || 0)} ${snapshot.baseAsset}`;

  dom.metricImbalance.textContent = formatPercent(derived.depthSummary.imbalance * 100);
  dom.metricImbalance.className = toneFromNumber(derived.depthSummary.imbalance, 0.03);
  dom.metricImbalanceNote.textContent = `Spread ${derived.depthSummary.spreadBps.toFixed(1)} bps • bid vs ask depth`;

  dom.metricCvd.textContent = formatCompactUsd(derived.tradeSummary.cvdValue, 1);
  dom.metricCvd.className = toneFromNumber(derived.tradeSummary.cvdSlope, 1);
  dom.metricCvdNote.textContent = `Rolling ${state.tradeHistory.length} trade delta • ${formatSigned(derived.tradeSummary.cvdSlope, 2, "%")} slope`;

  dom.metricFunding.textContent = formatSigned(derived.fundingRate, 4, "%");
  dom.metricFunding.className = toneFromNumber(derived.fundingRate, 0.001);
  dom.metricFundingNote.textContent = derived.nextFundingTime
    ? `Annualized ${formatSigned(derived.annualizedFunding, 2, "%")} • next ${new Date(derived.nextFundingTime).toLocaleString()}`
    : "Funding stream unavailable";

  dom.metricOi.textContent = formatSigned(derived.oiChange1h, 2, "%");
  dom.metricOi.className = toneFromNumber(derived.oiChange1h, 0.2);
  dom.metricOiNote.textContent = `4H ${formatSigned(derived.oiChange4h, 2, "%")} • current OI ${formatCompactNumber(derived.oiNow)}`;

  dom.metricLiq.textContent =
    derived.forceSummary.recentOrders.length > 0
      ? formatCompactUsd(derived.forceSummary.netNotional, 1)
      : "Watching";
  dom.metricLiq.className =
    derived.forceSummary.recentOrders.length > 0
      ? toneFromNumber(derived.forceSummary.netNotional, 10000)
      : "neutral";
  dom.metricLiqNote.textContent =
    derived.forceSummary.recentOrders.length > 0
      ? `${derived.forceSummary.recentOrders.length} recent forced orders • + means shorts hit`
      : "Waiting for live force-order events";

  renderAnalysisGrid(dom.taGrid, [
    {
      label: "EMA 20",
      value: formatPrice(derived.latestEma20, precision),
      note: derived.currentPrice > derived.latestEma20 ? "Price holds above fast trend" : "Price sits below fast trend",
      tone: derived.currentPrice > derived.latestEma20 ? "up" : "down",
    },
    {
      label: "EMA 50",
      value: formatPrice(derived.latestEma50, precision),
      note: derived.latestEma20 > derived.latestEma50 ? "Fast EMA leads slow EMA" : "Slow EMA is capping trend",
      tone: derived.latestEma20 > derived.latestEma50 ? "up" : "down",
    },
    {
      label: "VWAP",
      value: formatPrice(derived.latestVwap, precision),
      note: derived.currentPrice > derived.latestVwap ? "Price is trading above VWAP" : "Price is trading below VWAP",
      tone: derived.currentPrice > derived.latestVwap ? "up" : "down",
    },
    {
      label: "RSI (14)",
      value: derived.latestRsi.toFixed(1),
      note:
        derived.latestRsi > 70
          ? "Momentum is stretched"
          : derived.latestRsi < 35
            ? "Momentum is depressed"
            : "Momentum is in a tradable band",
      tone:
        derived.latestRsi >= 50 && derived.latestRsi <= 70
          ? "up"
          : derived.latestRsi < 45
            ? "down"
            : "neutral",
    },
    {
      label: "MACD Histogram",
      value: derived.latestMacdHistogram.toFixed(4),
      note: derived.latestMacdHistogram > 0 ? "Positive momentum expansion" : "Negative momentum expansion",
      tone: derived.latestMacdHistogram > 0 ? "up" : "down",
    },
    {
      label: "ATR (14)",
      value: formatPrice(derived.latestAtr, precision),
      note: "Average move per selected candle",
      tone: "neutral",
    },
    {
      label: "OBV Slope",
      value: formatSigned(derived.obvSlope, 2, "%"),
      note: derived.obvSlope > 0 ? "Volume confirms trend" : "Volume is not confirming",
      tone: derived.obvSlope > 0 ? "up" : "down",
    },
    {
      label: "Mark Premium",
      value: formatSigned(derived.markPremium, 3, "%"),
      note: "Mark vs index basis on the perp contract",
      tone: toneFromNumber(derived.markPremium, 0.02),
    },
  ]);

  renderAnalysisGrid(dom.flowGrid, [
    {
      label: "CVD Slope",
      value: formatSigned(derived.tradeSummary.cvdSlope, 2, "%"),
      note: derived.tradeSummary.cvdSlope > 0 ? "Aggressive buyers lead" : "Aggressive sellers lead",
      tone: derived.tradeSummary.cvdSlope > 0 ? "up" : "down",
    },
    {
      label: "Taker Buy/Sell",
      value: derived.takerSummary.latestRatio.toFixed(2),
      note: derived.takerSummary.latestRatio > 1 ? "Takers leaning buy side" : "Takers leaning sell side",
      tone: toneFromNumber(derived.takerSummary.latestRatio - 1, 0.02),
    },
    {
      label: "OI 1H",
      value: formatSigned(derived.oiChange1h, 2, "%"),
      note: "Short-term leverage expansion",
      tone: toneFromNumber(derived.oiChange1h, 0.2),
    },
    {
      label: "OI 4H",
      value: formatSigned(derived.oiChange4h, 2, "%"),
      note: "Broader leverage regime",
      tone: toneFromNumber(derived.oiChange4h, 0.2),
    },
    {
      label: "Funding Annualized",
      value: formatSigned(derived.annualizedFunding, 2, "%"),
      note: "Three funding windows extrapolated across a year",
      tone: toneFromNumber(derived.annualizedFunding, 2),
    },
    {
      label: "Regime",
      value: derived.regime.label,
      note: `BTC ${formatPercent(derived.btcChange)} • ETH ${formatPercent(derived.ethChange)}`,
      tone: derived.regime.tone,
    },
  ]);

  renderAnalysisGrid(dom.fundingGrid, [
    {
      label: "Funding Rate",
      value: formatSigned(derived.fundingRate, 4, "%"),
      note:
        derived.fundingRate > 0
          ? "Longs are paying shorts"
          : derived.fundingRate < 0
            ? "Shorts are paying longs"
            : "Funding is flat",
      tone: toneFromNumber(derived.fundingRate, 0.001),
    },
    {
      label: "Global L/S",
      value: derived.globalLongShortRatio.toFixed(2),
      note: derived.globalLongShortRatio > 1 ? "More accounts lean long" : "More accounts lean short",
      tone: toneFromNumber(derived.globalLongShortRatio - 1, 0.02),
    },
    {
      label: "Top Trader L/S",
      value: derived.topLongShortRatio.toFixed(2),
      note: derived.topLongShortRatio > 1 ? "Top traders lean long" : "Top traders lean short",
      tone: toneFromNumber(derived.topLongShortRatio - 1, 0.02),
    },
    {
      label: "Mark Price",
      value: formatPrice(derived.markPrice, precision),
      note: `Index ${formatPrice(derived.indexPrice, precision)}`,
      tone: toneFromNumber(derived.markPremium, 0.02),
    },
    {
      label: "OI Trend",
      value: formatSigned(derived.oiTrend, 2, "%"),
      note: "Net change over the full OI sample window",
      tone: toneFromNumber(derived.oiTrend, 0.2),
    },
    {
      label: "News Context",
      value:
        derived.newsScore > 0 ? "Supportive" : derived.newsScore < 0 ? "Heavy" : "Mixed",
      note: `${derived.newsItems.length} catalyst headlines scanned`,
      tone: derived.newsScore > 0 ? "up" : derived.newsScore < 0 ? "down" : "neutral",
    },
  ]);

  renderSetupGrid(derived.setups);

  renderSignalList([
    {
      label: "Directional Bias",
      value: derived.bias.label,
      note: `Score ${derived.biasScore} from trend, CVD, leverage, and headline context.`,
      tone: derived.bias.tone,
    },
    {
      label: "Nearest Support",
      value: derived.supportResistance.supportLevels[0]
        ? formatPrice(derived.supportResistance.supportLevels[0], precision)
        : "Not clear",
      note: "Loss of this area weakens long continuation.",
      tone: "up",
    },
    {
      label: "Nearest Resistance",
      value: derived.supportResistance.resistanceLevels[0]
        ? formatPrice(derived.supportResistance.resistanceLevels[0], precision)
        : "Not clear",
      note: "Acceptance above this area improves upside continuation odds.",
      tone: "down",
    },
    {
      label: "Leverage Read",
      value:
        derived.fundingRate < 0 && derived.oiChange1h > 0
          ? "Shorts crowded"
          : derived.fundingRate > 0 && derived.oiChange1h > 0
            ? "Longs building"
            : "Balanced",
      note: "Funding and OI together show whether perps positioning is getting one-sided.",
      tone:
        derived.fundingRate < 0 && derived.oiChange1h > 0
          ? "up"
          : derived.fundingRate > 0 && derived.oiChange1h > 0
            ? "down"
            : "neutral",
    },
  ]);

  renderTable(
    dom.flowTable,
    [
      {
        label: "Large Buy Flow",
        primary: formatCompactUsdAbs(derived.tradeSummary.bigBuyNotional, 1),
        secondaryLabel: "Large Sell Flow",
        secondary: formatCompactUsdAbs(derived.tradeSummary.bigSellNotional, 1),
        tertiaryLabel: "Net",
        tertiary: formatCompactUsd(derived.tradeSummary.netLargeFlow, 1),
        tone: derived.tradeSummary.netLargeFlow >= 0 ? "up" : "down",
      },
      {
        label: "CVD",
        primary: formatCompactUsd(derived.tradeSummary.cvdValue, 1),
        secondaryLabel: "Taker Ratio",
        secondary: derived.takerSummary.latestRatio.toFixed(2),
        tertiaryLabel: "Tape Bias",
        tertiary:
          derived.tradeSummary.totalBuyNotional >= derived.tradeSummary.totalSellNotional
            ? "Buyers active"
            : "Sellers active",
        tone:
          derived.tradeSummary.totalBuyNotional >= derived.tradeSummary.totalSellNotional
            ? "up"
            : "down",
      },
      {
        label: "Latest Whale Print",
        primary: derived.tradeSummary.latestWhale
          ? formatPrice(derived.tradeSummary.latestWhale.price, precision)
          : "Waiting",
        secondaryLabel: "Notional",
        secondary: derived.tradeSummary.latestWhale
          ? formatCompactUsdAbs(derived.tradeSummary.latestWhale.quoteNotional, 1)
          : "-",
        tertiaryLabel: "Side",
        tertiary: derived.tradeSummary.latestWhale
          ? derived.tradeSummary.latestWhale.isSellInitiated
            ? "Sell-initiated"
            : "Buy-initiated"
          : "-",
        tone:
          derived.tradeSummary.latestWhale && !derived.tradeSummary.latestWhale.isSellInitiated
            ? "up"
            : derived.tradeSummary.latestWhale
              ? "down"
              : "neutral",
      },
    ],
    "Trade flow unavailable"
  );

  renderTable(
    dom.depthTable,
    [
      ...derived.depthSummary.bidWalls.map((wall, index) => ({
        label: `Bid Wall ${index + 1}`,
        primary: formatPrice(wall.price, precision),
        secondaryLabel: "Size",
        secondary: formatCompactNumber(wall.quantity),
        tertiaryLabel: "Notional",
        tertiary: formatCompactUsdAbs(wall.notional, 1),
        tone: "up",
      })),
      ...derived.depthSummary.askWalls.map((wall, index) => ({
        label: `Ask Wall ${index + 1}`,
        primary: formatPrice(wall.price, precision),
        secondaryLabel: "Size",
        secondary: formatCompactNumber(wall.quantity),
        tertiaryLabel: "Notional",
        tertiary: formatCompactUsdAbs(wall.notional, 1),
        tone: "down",
      })),
    ].slice(0, 6),
    "Order-book wall data unavailable"
  );

  renderTable(
    dom.liquidationTable,
    [
      {
        label: "Short Liquidations",
        primary: formatCompactUsdAbs(derived.forceSummary.shortLiquidationNotional, 1),
        secondaryLabel: "Long Liquidations",
        secondary: formatCompactUsdAbs(derived.forceSummary.longLiquidationNotional, 1),
        tertiaryLabel: "Net",
        tertiary: formatCompactUsd(derived.forceSummary.netNotional, 1),
        tone: derived.forceSummary.netNotional >= 0 ? "up" : "down",
      },
      ...derived.forceSummary.recentOrders.slice(0, 5).map((order) => ({
        label: order.side === "BUY" ? "Shorts hit" : "Longs hit",
        primary: formatPrice(order.price, precision),
        secondaryLabel: "Notional",
        secondary: formatCompactUsdAbs(order.notional, 1),
        tertiaryLabel: "Time",
        tertiary: formatTimestamp(order.time),
        tone: order.side === "BUY" ? "up" : "down",
      })),
    ],
    "Waiting for force-order events"
  );

  renderNews(derived.newsItems);
  renderTimeframeSummary();

  setStatus(
    `${snapshot.symbol} live on Binance futures via ${
      snapshot.dataSource === "browser" ? "direct browser" : "Vercel server"
    } data. If the requested token resolves to another perp contract, the subtitle shows the exact symbol being analyzed.`,
    derived.bias.tone
  );
}

function disconnectStreams() {
  const streams = [...state.streams];
  state.streams = [];
  streams.forEach((stream) => {
    stream.manualClose = true;
    try {
      stream.socket.close();
    } catch (error) {
      console.error(error);
    }
  });
  updateStreamBadge();
}

function openStream(name, url, onMessage) {
  const stream = {
    name,
    url,
    connected: false,
    manualClose: false,
    socket: null,
  };

  const socket = new WebSocket(url);
  stream.socket = socket;
  state.streams.push(stream);
  updateStreamBadge();

  socket.onopen = () => {
    stream.connected = true;
    updateStreamBadge();
  };

  socket.onmessage = (event) => {
    try {
      onMessage(JSON.parse(event.data));
    } catch (error) {
      console.error(`${name} stream parse error`, error);
    }
  };

  socket.onerror = () => {
    stream.connected = false;
    updateStreamBadge();
  };

  socket.onclose = () => {
    state.streams = state.streams.filter((candidate) => candidate !== stream);
    updateStreamBadge();

    if (stream.manualClose || !state.snapshot) return;

    window.setTimeout(() => {
      if (!state.snapshot || stream.manualClose) return;
      openStream(name, url, onMessage);
    }, STREAM_RECONNECT_DELAY_MS);
  };
}

function upsertLiveCandle(nextCandle) {
  const lastCandle = state.candles[state.candles.length - 1];
  if (lastCandle && lastCandle.time === nextCandle.time) {
    state.candles[state.candles.length - 1] = nextCandle;
  } else {
    state.candles.push(nextCandle);
    if (state.candles.length > 320) state.candles.shift();
  }

  candleSeries.update(nextCandle);
  volumeSeries.update({
    time: nextCandle.time,
    value: nextCandle.volume,
    color: volumeColor(nextCandle),
  });
}

function connectStreams(symbol, interval) {
  const lowerSymbol = symbol.toLowerCase();

  openStream(
    "kline",
    `wss://fstream.binance.com/ws/${lowerSymbol}@kline_${interval}`,
    (payload) => {
      const candle = payload.k;
      if (!candle) return;
      const nextCandle = {
        time: Math.floor(Number(candle.t) / 1000),
        open: Number(candle.o),
        high: Number(candle.h),
        low: Number(candle.l),
        close: Number(candle.c),
        volume: Number(candle.v),
      };
      state.liveLastPrice = nextCandle.close;
      upsertLiveCandle(nextCandle);
      scheduleRender();
    }
  );

  openStream(
    "markPrice",
    `wss://fstream.binance.com/ws/${lowerSymbol}@markPrice@1s`,
    (payload) => {
      state.liveMarkPrice = Number(payload.p);
      state.liveIndexPrice = Number(payload.i);
      state.liveFundingRate = Number(payload.r) * 100;
      state.liveNextFundingTime = Number(payload.T);
      scheduleRender();
    }
  );

  openStream(
    "aggTrade",
    `wss://fstream.binance.com/ws/${lowerSymbol}@aggTrade`,
    (payload) => {
      const trade = normalizeTrade(payload);
      state.tradeHistory.push(trade);
      if (state.tradeHistory.length > MAX_TRADE_SAMPLES) state.tradeHistory.shift();
      state.liveLastPrice = trade.price;
      scheduleRender();
    }
  );

  openStream(
    "depth",
    `wss://fstream.binance.com/ws/${lowerSymbol}@depth20@100ms`,
    (payload) => {
      state.liveDepth = {
        bids: payload.b || payload.bids || [],
        asks: payload.a || payload.asks || [],
      };
      scheduleRender();
    }
  );

  openStream(
    "forceOrder",
    `wss://fstream.binance.com/ws/${lowerSymbol}@forceOrder`,
    (payload) => {
      const order = payload.o || payload;
      if (!order) return;
      const price = Number(order.ap || order.p);
      const quantity = Number(order.z || order.q || order.l || 0);
      state.forceOrders.push({
        side: order.S,
        price,
        quantity,
        notional: price * quantity,
        time: Number(order.T || Date.now()),
      });
      if (state.forceOrders.length > MAX_FORCE_ORDERS) state.forceOrders.shift();
      scheduleRender();
    }
  );
}

async function loadDashboard(token, interval) {
  const requestId = ++state.requestId;
  state.activeToken = normalizeToken(token);
  state.activeInterval = interval;
  disconnectStreams();
  clearRenderTimer();
  clearTradeRefreshTimer();
  state.snapshot = null;
  state.timeframeSummary = [];
  state.timeframeSummaryLoading = true;
  resetChart();
  renderEmptyDashboard(`Loading ${normalizeToken(token)} perpetual market snapshot...`);
  setTradeRefreshNote("Refreshing trade setup...");
  setStatus(`Loading ${normalizeToken(token)} perpetual market structure...`);

  try {
    const snapshot = await fetchSnapshot(token, interval);
    if (requestId !== state.requestId) return;

    primeState(snapshot);
    renderDashboard();
    connectStreams(snapshot.symbol, interval);
    refreshTimeframeSummary(requestId, snapshot, interval);
    setTradeRefreshNote(
      `Updated ${new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })} • auto 15m`
    );
    scheduleTradeAutoRefresh();
  } catch (error) {
    if (requestId !== state.requestId) return;
    state.snapshot = null;
    state.timeframeSummary = [];
    state.timeframeSummaryLoading = false;
    renderEmptyDashboard(error.message);
    setStatus(error.message, "down");
    setStreamStatus("Live feeds offline", "down");
    setTradeRefreshNote("Auto refresh will retry in 15m");
    scheduleTradeAutoRefresh();
    console.error(error);
  }
}

dom.tokenForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const token = dom.tokenInput.value || DEFAULT_TOKEN;
  const interval = dom.intervalSelect.value || DEFAULT_INTERVAL;
  loadDashboard(token, interval);
});

dom.tradeRefreshButton.addEventListener("click", () => {
  const token = state.activeToken || dom.tokenInput.value || DEFAULT_TOKEN;
  const interval = state.activeInterval || dom.intervalSelect.value || DEFAULT_INTERVAL;
  loadDashboard(token, interval);
});

loadDashboard(DEFAULT_TOKEN, DEFAULT_INTERVAL);
