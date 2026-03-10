const DEFAULT_TOKEN = "BTC";
const DEFAULT_QUOTE = "USDT";
const DEFAULT_INTERVAL = "15m";
const NEWS_FALLBACK_ITEMS = 5;

const dom = {
  assetTitle: document.getElementById("asset-title"),
  headlinePrice: document.getElementById("headline-price"),
  headlineChange: document.getElementById("headline-change"),
  headlineBias: document.getElementById("headline-bias"),
  supportFields: document.getElementById("support-fields"),
  resistanceFields: document.getElementById("resistance-fields"),
  outlookSummary: document.getElementById("outlook-summary"),
  signalList: document.getElementById("signal-list"),
  biasScore: document.getElementById("bias-score"),
  statusBanner: document.getElementById("status-banner"),
  metricVolume: document.getElementById("metric-volume"),
  metricVolumeNote: document.getElementById("metric-volume-note"),
  metricImbalance: document.getElementById("metric-imbalance"),
  metricImbalanceNote: document.getElementById("metric-imbalance-note"),
  metricFlow: document.getElementById("metric-flow"),
  metricFlowNote: document.getElementById("metric-flow-note"),
  metricFunding: document.getElementById("metric-funding"),
  metricFundingNote: document.getElementById("metric-funding-note"),
  metricOi: document.getElementById("metric-oi"),
  metricOiNote: document.getElementById("metric-oi-note"),
  metricRegime: document.getElementById("metric-regime"),
  metricRegimeNote: document.getElementById("metric-regime-note"),
  taGrid: document.getElementById("ta-grid"),
  flowTable: document.getElementById("flow-table"),
  depthTable: document.getElementById("depth-table"),
  fundingGrid: document.getElementById("funding-grid"),
  newsFeed: document.getElementById("news-feed"),
  tokenForm: document.getElementById("token-form"),
  tokenInput: document.getElementById("token-input"),
  intervalSelect: document.getElementById("interval-select"),
  chart: document.getElementById("chart"),
};

let chart;
let candleSeries;
let volumeSeries;
let priceLines = [];

function setStatus(message, tone = "neutral") {
  dom.statusBanner.textContent = message;
  dom.statusBanner.className = `status-banner ${tone}`;
}

function normalizeToken(rawToken) {
  const cleaned = rawToken.toUpperCase().trim().replace(/[^A-Z0-9]/g, "");
  return cleaned.replace(new RegExp(`${DEFAULT_QUOTE}$`), "") || DEFAULT_TOKEN;
}

function pairFor(token) {
  return `${token}${DEFAULT_QUOTE}`;
}

function formatCompactNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: digits,
  }).format(value);
}

function formatUsd(value, digits = 2) {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value, digits = 2) {
  if (!Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatSigned(value, digits = 2, suffix = "") {
  if (!Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`;
}

function toneFromNumber(value, flatBand = 0.02) {
  if (!Number.isFinite(value)) return "neutral";
  if (value > flatBand) return "up";
  if (value < -flatBand) return "down";
  return "neutral";
}

function setTextWithTone(element, text, tone) {
  element.textContent = text;
  element.className = tone;
}

function initChart() {
  const chartOptions = {
    layout: {
      background: { color: "rgba(228, 231, 235, 0.95)" },
      textColor: "#47515d",
      fontFamily: "Manrope, sans-serif",
    },
    grid: {
      vertLines: { color: "rgba(80, 90, 102, 0.08)" },
      horzLines: { color: "rgba(80, 90, 102, 0.08)" },
    },
    timeScale: {
      borderColor: "rgba(80, 90, 102, 0.12)",
      timeVisible: true,
    },
    rightPriceScale: {
      borderColor: "rgba(80, 90, 102, 0.12)",
    },
    crosshair: {
      vertLine: { color: "rgba(63, 71, 82, 0.25)" },
      horzLine: { color: "rgba(63, 71, 82, 0.25)" },
    },
  };

  chart = LightweightCharts.createChart(dom.chart, {
    ...chartOptions,
    width: dom.chart.clientWidth,
    height: dom.chart.clientHeight,
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: "#0d8f54",
    downColor: "#c23a3a",
    wickUpColor: "#0d8f54",
    wickDownColor: "#c23a3a",
    borderVisible: false,
  });

  volumeSeries = chart.addHistogramSeries({
    priceFormat: { type: "volume" },
    priceScaleId: "",
    color: "rgba(74, 84, 98, 0.35)",
    base: 0,
  });

  volumeSeries.priceScale().applyOptions({
    scaleMargins: {
      top: 0.82,
      bottom: 0,
    },
  });

  window.addEventListener("resize", () => {
    chart.applyOptions({
      width: dom.chart.clientWidth,
      height: dom.chart.clientHeight,
    });
  });
}

function removePriceLines() {
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

async function fetchJson(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label} request failed (${response.status})`);
  }
  return response.json();
}

function toCandles(rawKlines) {
  return rawKlines.map((entry) => ({
    time: Math.floor(entry[0] / 1000),
    open: Number(entry[1]),
    high: Number(entry[2]),
    low: Number(entry[3]),
    close: Number(entry[4]),
    volume: Number(entry[5]),
  }));
}

function ema(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const seed = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const result = new Array(period - 1).fill(null);
  let previous = seed;
  result.push(seed);
  for (let index = period; index < values.length; index += 1) {
    previous = values[index] * k + previous * (1 - k);
    result.push(previous);
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
  let currentAtr =
    trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
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

function slopePercentage(values, lookback = 10) {
  const filtered = values.filter((value) => value != null);
  if (filtered.length <= lookback) return 0;
  const start = filtered[filtered.length - 1 - lookback];
  const end = filtered[filtered.length - 1];
  if (!Number.isFinite(start) || start === 0 || !Number.isFinite(end)) return 0;
  return ((end - start) / Math.abs(start)) * 100;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index];
}

function computeSupportResistance(candles, currentPrice, latestAtr) {
  const supports = [];
  const resistances = [];
  const lookback = 3;

  for (let index = lookback; index < candles.length - lookback; index += 1) {
    const candle = candles[index];
    const prev = candles.slice(index - lookback, index);
    const next = candles.slice(index + 1, index + 1 + lookback);

    const isSupport =
      prev.every((item) => candle.low <= item.low) &&
      next.every((item) => candle.low <= item.low);
    const isResistance =
      prev.every((item) => candle.high >= item.high) &&
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
        lastGroup.center =
          lastGroup.levels.reduce((sum, value) => sum + value, 0) / lastGroup.levels.length;
        return groups;
      }, [])
      .map((group) => group.center);
  }

  const supportLevels = clusterLevels(supports)
    .filter((level) => level < currentPrice)
    .sort((left, right) => right - left)
    .slice(0, 2);

  const resistanceLevels = clusterLevels(resistances)
    .filter((level) => level > currentPrice)
    .sort((left, right) => left - right)
    .slice(0, 2);

  return { supportLevels, resistanceLevels, bandWidth: clusterThreshold / 2 };
}

function analyzeTrades(rawTrades) {
  if (!Array.isArray(rawTrades) || !rawTrades.length) {
    return {
      totalBuyNotional: 0,
      totalSellNotional: 0,
      bigBuyNotional: 0,
      bigSellNotional: 0,
      netLargeFlow: 0,
      bigTradeCount: 0,
    };
  }

  const trades = rawTrades.map((trade) => ({
    price: Number(trade.p),
    quantity: Number(trade.q),
    quoteNotional: Number(trade.p) * Number(trade.q),
    isSellInitiated: Boolean(trade.m),
  }));

  const notionals = trades.map((trade) => trade.quoteNotional);
  const whaleCutoff = percentile(notionals, 0.9);

  return trades.reduce(
    (summary, trade) => {
      if (trade.isSellInitiated) summary.totalSellNotional += trade.quoteNotional;
      else summary.totalBuyNotional += trade.quoteNotional;

      if (trade.quoteNotional >= whaleCutoff) {
        summary.bigTradeCount += 1;
        if (trade.isSellInitiated) summary.bigSellNotional += trade.quoteNotional;
        else summary.bigBuyNotional += trade.quoteNotional;
      }

      return summary;
    },
    {
      totalBuyNotional: 0,
      totalSellNotional: 0,
      bigBuyNotional: 0,
      bigSellNotional: 0,
      netLargeFlow: 0,
      bigTradeCount: 0,
    }
  );
}

function analyzeOrderbook(rawDepth, referencePrice) {
  const depth = rawDepth || { bids: [], asks: [] };
  const topBids = (depth.bids || []).slice(0, 25).map(([price, quantity]) => ({
    price: Number(price),
    quantity: Number(quantity),
    notional: Number(price) * Number(quantity),
  }));
  const topAsks = (depth.asks || []).slice(0, 25).map(([price, quantity]) => ({
    price: Number(price),
    quantity: Number(quantity),
    notional: Number(price) * Number(quantity),
  }));

  const bidSum = topBids.reduce((sum, level) => sum + level.notional, 0);
  const askSum = topAsks.reduce((sum, level) => sum + level.notional, 0);
  const imbalance = bidSum + askSum === 0 ? 0 : (bidSum - askSum) / (bidSum + askSum);

  const bidCutoff = percentile(topBids.map((level) => level.notional), 0.82);
  const askCutoff = percentile(topAsks.map((level) => level.notional), 0.82);

  const bidWalls = topBids
    .filter((level) => level.notional >= bidCutoff)
    .sort((left, right) => right.price - left.price)
    .slice(0, 3);
  const askWalls = topAsks
    .filter((level) => level.notional >= askCutoff)
    .sort((left, right) => left.price - right.price)
    .slice(0, 3);

  const nearestBidWall = bidWalls[0];
  const nearestAskWall = askWalls[0];

  return {
    imbalance,
    bidWalls,
    askWalls,
    nearestBidWall,
    nearestAskWall,
    spreadBps:
      nearestBidWall && nearestAskWall && referencePrice
        ? ((nearestAskWall.price - nearestBidWall.price) / referencePrice) * 10000
        : 0,
  };
}

function latestDefinedValue(values) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] != null) return values[index];
  }
  return null;
}

function classifyNews(item) {
  const title = `${item.title || ""} ${item.body || ""}`.toLowerCase();
  const bullishWords = ["etf", "approval", "partnership", "adoption", "inflow", "surge", "expansion"];
  const bearishWords = ["hack", "exploit", "lawsuit", "ban", "outflow", "crackdown", "liquidation"];
  const bullishHits = bullishWords.filter((word) => title.includes(word)).length;
  const bearishHits = bearishWords.filter((word) => title.includes(word)).length;

  if (bullishHits > bearishHits) return "up";
  if (bearishHits > bullishHits) return "down";
  return "neutral";
}

function buildBiasScore({
  priceChange24h,
  currentPrice,
  ema20,
  ema50,
  latestRsi,
  latestMacdHistogram,
  obvSlope,
  largeFlowRatio,
  imbalance,
  fundingRate,
  openInterestTrend,
  globalLongShortRatio,
  newsScore,
  btcChange,
  ethChange,
}) {
  let score = 0;

  if (currentPrice > ema20) score += 10;
  else score -= 10;

  if (ema20 > ema50) score += 14;
  else score -= 14;

  if (latestRsi >= 54 && latestRsi <= 69) score += 11;
  else if (latestRsi > 75) score -= 6;
  else if (latestRsi < 44) score -= 11;

  if (latestMacdHistogram > 0) score += 10;
  else score -= 10;

  if (priceChange24h > 0) score += 8;
  else score -= 8;

  if (obvSlope > 0) score += 7;
  else score -= 7;

  if (largeFlowRatio > 0.05) score += 10;
  else if (largeFlowRatio < -0.05) score -= 10;

  if (imbalance > 0.05) score += 10;
  else if (imbalance < -0.05) score -= 10;

  if (fundingRate > 0 && fundingRate < 0.03) score += 5;
  else if (fundingRate >= 0.03) score -= 4;
  else if (fundingRate < 0) score -= 5;

  if (openInterestTrend > 0) score += 6;
  else score -= 6;

  if (globalLongShortRatio > 1.05) score += 5;
  else if (globalLongShortRatio < 0.95) score -= 5;

  score += newsScore * 4;

  if (btcChange > 0 && ethChange > 0) score += 4;
  else if (btcChange < 0 && ethChange < 0) score -= 4;

  return Math.max(-100, Math.min(100, Math.round(score)));
}

function biasDescriptor(score) {
  if (score >= 35) return { label: "Bullish", tone: "up" };
  if (score >= 10) return { label: "Slightly Bullish", tone: "up" };
  if (score <= -35) return { label: "Bearish", tone: "down" };
  if (score <= -10) return { label: "Slightly Bearish", tone: "down" };
  return { label: "Balanced", tone: "neutral" };
}

function createPill(text, tone) {
  const pill = document.createElement("span");
  pill.className = `pill ${tone}`;
  pill.textContent = text;
  return pill;
}

function renderLevelBands(container, levels, bandWidth, tone) {
  container.innerHTML = "";
  if (!levels.length) {
    container.appendChild(createPill("No clear level", "neutral"));
    return;
  }

  levels.forEach((level) => {
    const low = level - bandWidth;
    const high = level + bandWidth;
    container.appendChild(createPill(`${formatUsd(low)} - ${formatUsd(high)}`, tone));
  });
}

function renderAnalysisGrid(container, items) {
  container.innerHTML = "";
  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "analysis-card";
    const tone = item.tone || "neutral";
    card.innerHTML = `
      <span>${item.label}</span>
      <strong class="${tone}">${item.value}</strong>
      <small>${item.note}</small>
    `;
    container.appendChild(card);
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
    container.innerHTML = `<div class="table-row"><strong>${emptyText}</strong><span>-</span><span>-</span></div>`;
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

function renderNews(items) {
  dom.newsFeed.innerHTML = "";
  if (!items.length) {
    dom.newsFeed.innerHTML =
      '<article class="news-item"><strong>No news feed available for this token right now.</strong><span class="news-meta">Try BTC, ETH, SOL, or another widely covered asset.</span></article>';
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

function marketRegimeLabel(btcChange, ethChange) {
  if (btcChange > 0 && ethChange > 0) return { label: "Risk-On", tone: "up" };
  if (btcChange < 0 && ethChange < 0) return { label: "Risk-Off", tone: "down" };
  return { label: "Mixed Tape", tone: "neutral" };
}

function volumeColor(candle) {
  return candle.close >= candle.open ? "rgba(13, 143, 84, 0.35)" : "rgba(194, 58, 58, 0.35)";
}

function buildOutlook({
  bias,
  currentPrice,
  supportLevels,
  resistanceLevels,
  fundingRate,
  imbalance,
  largeFlowRatio,
  openInterestTrend,
  nearestBidWall,
  nearestAskWall,
}) {
  const firstSupport = supportLevels[0];
  const firstResistance = resistanceLevels[0];
  const directionText =
    bias.label === "Bullish" || bias.label === "Slightly Bullish"
      ? `${formatUsd(currentPrice)} is holding constructive momentum. A 5H continuation has room toward ${firstResistance ? formatUsd(firstResistance) : "higher intraday levels"} as long as buyers keep defending ${firstSupport ? formatUsd(firstSupport) : "the latest swing low"}.`
      : bias.label === "Bearish" || bias.label === "Slightly Bearish"
        ? `${formatUsd(currentPrice)} is trading with fragile structure. Over the next 5H, failure to reclaim ${firstResistance ? formatUsd(firstResistance) : "nearby resistance"} keeps pressure on ${firstSupport ? formatUsd(firstSupport) : "recent support"}.`
        : `${formatUsd(currentPrice)} is in a balanced range. The next 5H likely stays mean-reverting unless price forces a break through ${firstResistance ? formatUsd(firstResistance) : "resistance"} or loses ${firstSupport ? formatUsd(firstSupport) : "support"}.`;

  const leverageText =
    fundingRate > 0 && openInterestTrend > 0
      ? "Funding and open interest are rising together, which supports upside continuation but also increases squeeze risk if momentum fades."
      : fundingRate < 0 && openInterestTrend > 0
        ? "Open interest is expanding into negative funding, which can signal crowded shorts and a rebound setup if spot demand improves."
        : "Leverage positioning is not yet extreme, so spot and order-book behavior should carry more weight than funding alone.";

  const wallText =
    nearestBidWall && nearestAskWall
      ? `Depth is leaning ${imbalance >= 0 ? "toward bids" : "toward asks"}, with visible size parked near ${formatUsd(nearestBidWall.price)} on the bid and ${formatUsd(nearestAskWall.price)} on the ask. Large-trade flow is ${largeFlowRatio >= 0 ? "favoring buyers" : "favoring sellers"}.`
      : "Order-book wall data is thin for this pair, so the tactical view leans more on price structure and momentum.";

  return `${directionText} ${leverageText} ${wallText}`;
}

async function loadDashboard(token, interval) {
  const normalizedToken = normalizeToken(token);
  const symbol = pairFor(normalizedToken);
  setStatus(`Loading ${symbol} market structure, flows, and headlines...`);
  dom.assetTitle.textContent = `${normalizedToken} / ${DEFAULT_QUOTE}`;

  try {
    await fetchJson(
      `https://api.binance.com/api/v3/exchangeInfo?symbol=${symbol}`,
      "Exchange info"
    );
  } catch (error) {
    setStatus(
      `${symbol} is not available on Binance spot. Try a liquid USDT pair such as BTC, ETH, SOL, or XRP.`,
      "down"
    );
    throw error;
  }

  const requests = await Promise.allSettled([
    fetchJson(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=240`, "Klines"),
    fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`, "24H ticker"),
    fetchJson(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=100`, "Orderbook"),
    fetchJson(`https://api.binance.com/api/v3/aggTrades?symbol=${symbol}&limit=250`, "Agg trades"),
    fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`, "Funding"),
    fetchJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`, "Open interest"),
    fetchJson(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=30`, "OI history"),
    fetchJson(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=10`, "Global long/short"),
    fetchJson(`https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${symbol}&period=1h&limit=10`, "Top long/short"),
    fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT`, "BTC context"),
    fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT`, "ETH context"),
    fetchJson(
      `https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=${normalizedToken},BTC,ETH,Regulation,Blockchain&excludeCategories=Sponsored`,
      "News"
    ),
  ]);

  const [
    klinesResult,
    tickerResult,
    depthResult,
    tradesResult,
    fundingResult,
    openInterestResult,
    oiHistoryResult,
    globalLsResult,
    topLsResult,
    btcContextResult,
    ethContextResult,
    newsResult,
  ] = requests;

  if (klinesResult.status !== "fulfilled" || tickerResult.status !== "fulfilled") {
    setStatus(`Core market data failed for ${symbol}.`, "down");
    throw new Error("Core market data unavailable");
  }

  const candles = toCandles(klinesResult.value);
  const closes = candles.map((candle) => candle.close);
  const currentPrice = closes[closes.length - 1];
  const ticker = tickerResult.value;
  const priceChange24h = Number(ticker.priceChangePercent);
  const ema20Series = ema(closes, 20);
  const ema50Series = ema(closes, 50);
  const rsiSeries = rsi(closes, 14);
  const macdSeries = macd(closes);
  const atrSeries = atr(candles, 14);
  const obvSeries = onBalanceVolume(candles);

  const latestEma20 = latestDefinedValue(ema20Series) ?? currentPrice;
  const latestEma50 = latestDefinedValue(ema50Series) ?? currentPrice;
  const latestRsi = latestDefinedValue(rsiSeries) ?? 50;
  const latestMacdHistogram = latestDefinedValue(macdSeries.histogram) ?? 0;
  const latestAtr = latestDefinedValue(atrSeries) ?? currentPrice * 0.01;
  const obvSlope = slopePercentage(obvSeries, 12);

  const tradeSummary =
    tradesResult.status === "fulfilled" ? analyzeTrades(tradesResult.value) : analyzeTrades([]);
  tradeSummary.netLargeFlow = tradeSummary.bigBuyNotional - tradeSummary.bigSellNotional;
  const totalLargeFlow = tradeSummary.bigBuyNotional + tradeSummary.bigSellNotional;
  const largeFlowRatio =
    totalLargeFlow === 0 ? 0 : tradeSummary.netLargeFlow / totalLargeFlow;

  const depthSummary =
    depthResult.status === "fulfilled"
      ? analyzeOrderbook(depthResult.value, currentPrice)
      : analyzeOrderbook(null, currentPrice);

  const supportResistance = computeSupportResistance(candles, currentPrice, latestAtr);

  const fundingData =
    fundingResult.status === "fulfilled"
      ? {
          markPrice: Number(fundingResult.value.markPrice),
          indexPrice: Number(fundingResult.value.indexPrice),
          fundingRate: Number(fundingResult.value.lastFundingRate) * 100,
          nextFundingTime: Number(fundingResult.value.nextFundingTime),
        }
      : { markPrice: currentPrice, indexPrice: currentPrice, fundingRate: 0, nextFundingTime: 0 };

  const oiNow =
    openInterestResult.status === "fulfilled"
      ? Number(openInterestResult.value.openInterest)
      : 0;
  const oiHistory =
    oiHistoryResult.status === "fulfilled"
      ? oiHistoryResult.value.map((entry) => Number(entry.sumOpenInterest))
      : [];
  const openInterestTrend =
    oiHistory.length > 1 && oiHistory[0] !== 0
      ? ((oiHistory[oiHistory.length - 1] - oiHistory[0]) / oiHistory[0]) * 100
      : 0;

  const globalLs =
    globalLsResult.status === "fulfilled" && globalLsResult.value.length
      ? Number(globalLsResult.value[globalLsResult.value.length - 1].longShortRatio)
      : 1;
  const topLs =
    topLsResult.status === "fulfilled" && topLsResult.value.length
      ? Number(topLsResult.value[topLsResult.value.length - 1].longShortRatio)
      : 1;

  const btcChange =
    btcContextResult.status === "fulfilled"
      ? Number(btcContextResult.value.priceChangePercent)
      : 0;
  const ethChange =
    ethContextResult.status === "fulfilled"
      ? Number(ethContextResult.value.priceChangePercent)
      : 0;
  const regime = marketRegimeLabel(btcChange, ethChange);

  const newsItems =
    newsResult.status === "fulfilled" && Array.isArray(newsResult.value.Data)
      ? newsResult.value.Data.slice(0, NEWS_FALLBACK_ITEMS)
      : [];
  const newsScore = newsItems.reduce((score, item) => {
    const tone = classifyNews(item);
    if (tone === "up") return score + 1;
    if (tone === "down") return score - 1;
    return score;
  }, 0);

  const biasScore = buildBiasScore({
    priceChange24h,
    currentPrice,
    ema20: latestEma20,
    ema50: latestEma50,
    latestRsi,
    latestMacdHistogram,
    obvSlope,
    largeFlowRatio,
    imbalance: depthSummary.imbalance,
    fundingRate: fundingData.fundingRate,
    openInterestTrend,
    globalLongShortRatio: globalLs,
    newsScore,
    btcChange,
    ethChange,
  });
  const bias = biasDescriptor(biasScore);

  candleSeries.setData(candles);
  volumeSeries.setData(
    candles.map((candle) => ({
      time: candle.time,
      value: candle.volume,
      color: volumeColor(candle),
    }))
  );
  chart.timeScale().fitContent();
  removePriceLines();
  supportResistance.supportLevels.forEach((level, index) =>
    addLevelLine(level, `S${index + 1}`, "#0d8f54")
  );
  supportResistance.resistanceLevels.forEach((level, index) =>
    addLevelLine(level, `R${index + 1}`, "#c23a3a")
  );

  dom.headlinePrice.textContent = formatUsd(currentPrice, currentPrice < 1 ? 4 : 2);
  dom.headlineChange.textContent = formatPercent(priceChange24h);
  dom.headlineChange.className = toneFromNumber(priceChange24h, 0.15);
  dom.headlineBias.textContent = bias.label;
  dom.headlineBias.className = bias.tone;

  renderLevelBands(
    dom.supportFields,
    supportResistance.supportLevels,
    supportResistance.bandWidth,
    "up"
  );
  renderLevelBands(
    dom.resistanceFields,
    supportResistance.resistanceLevels,
    supportResistance.bandWidth,
    "down"
  );

  dom.biasScore.textContent = `${biasScore}`;
  dom.biasScore.className = `score-badge ${bias.tone}`;

  setTextWithTone(dom.metricVolume, formatCompactNumber(Number(ticker.quoteVolume)), toneFromNumber(priceChange24h, 0.15));
  dom.metricVolumeNote.textContent = `24H quote volume • ${formatCompactNumber(Number(ticker.volume))} ${normalizedToken}`;

  setTextWithTone(
    dom.metricImbalance,
    formatPercent(depthSummary.imbalance * 100),
    toneFromNumber(depthSummary.imbalance, 0.03)
  );
  dom.metricImbalanceNote.textContent = `Spread ${depthSummary.spreadBps.toFixed(1)} bps`;

  setTextWithTone(
    dom.metricFlow,
    formatPercent(largeFlowRatio * 100),
    toneFromNumber(largeFlowRatio, 0.03)
  );
  dom.metricFlowNote.textContent = `${tradeSummary.bigTradeCount} large trades scanned`;

  setTextWithTone(
    dom.metricFunding,
    formatSigned(fundingData.fundingRate, 4, "%"),
    toneFromNumber(fundingData.fundingRate, 0.001)
  );
  dom.metricFundingNote.textContent = fundingData.nextFundingTime
    ? `Next funding ${new Date(fundingData.nextFundingTime).toLocaleString()}`
    : "Futures funding unavailable";

  setTextWithTone(
    dom.metricOi,
    formatSigned(openInterestTrend, 2, "%"),
    toneFromNumber(openInterestTrend, 0.2)
  );
  dom.metricOiNote.textContent = `Current OI ${formatCompactNumber(oiNow)} contracts`;

  setTextWithTone(dom.metricRegime, regime.label, regime.tone);
  dom.metricRegimeNote.textContent = `BTC ${formatPercent(btcChange)} • ETH ${formatPercent(ethChange)}`;

  renderAnalysisGrid(dom.taGrid, [
    {
      label: "EMA 20 vs Price",
      value: formatUsd(latestEma20, currentPrice < 1 ? 4 : 2),
      note: currentPrice > latestEma20 ? "Price is above the fast trend line" : "Price is below the fast trend line",
      tone: currentPrice > latestEma20 ? "up" : "down",
    },
    {
      label: "EMA 50",
      value: formatUsd(latestEma50, currentPrice < 1 ? 4 : 2),
      note: latestEma20 > latestEma50 ? "Fast EMA leads slow EMA" : "Slow EMA is capping trend",
      tone: latestEma20 > latestEma50 ? "up" : "down",
    },
    {
      label: "RSI (14)",
      value: latestRsi.toFixed(1),
      note:
        latestRsi > 70
          ? "Momentum is hot; watch for exhaustion"
          : latestRsi < 40
            ? "Momentum is weak"
            : "Momentum is in a tradable band",
      tone: latestRsi >= 50 && latestRsi <= 70 ? "up" : latestRsi < 45 ? "down" : "neutral",
    },
    {
      label: "MACD Histogram",
      value: latestMacdHistogram.toFixed(4),
      note: latestMacdHistogram > 0 ? "Momentum expansion favors buyers" : "Momentum expansion favors sellers",
      tone: latestMacdHistogram > 0 ? "up" : "down",
    },
    {
      label: "ATR (14)",
      value: formatUsd(latestAtr, currentPrice < 1 ? 4 : 2),
      note: "Average move per candle on the selected timeframe",
      tone: "neutral",
    },
    {
      label: "OBV Slope",
      value: formatSigned(obvSlope, 2, "%"),
      note: obvSlope > 0 ? "Volume flow confirms price action" : "Volume flow is not confirming",
      tone: obvSlope > 0 ? "up" : "down",
    },
  ]);

  renderSignalList([
    {
      label: "Directional Bias",
      value: bias.label,
      note: `Rule-based score ${biasScore} from trend, flow, funding, and headlines.`,
      tone: bias.tone,
    },
    {
      label: "Nearest Support",
      value: supportResistance.supportLevels[0]
        ? formatUsd(supportResistance.supportLevels[0], currentPrice < 1 ? 4 : 2)
        : "Not clear",
      note: "Spot must hold here to preserve near-term structure.",
      tone: "up",
    },
    {
      label: "Nearest Resistance",
      value: supportResistance.resistanceLevels[0]
        ? formatUsd(supportResistance.resistanceLevels[0], currentPrice < 1 ? 4 : 2)
        : "Not clear",
      note: "Break and hold above this level improves upside continuation odds.",
      tone: "down",
    },
    {
      label: "Leverage Setup",
      value:
        fundingData.fundingRate > 0 && openInterestTrend > 0
          ? "Longs building"
          : fundingData.fundingRate < 0 && openInterestTrend > 0
            ? "Shorts crowded"
            : "Balanced",
      note: "Funding + open interest describe how crowded the futures side is.",
      tone:
        fundingData.fundingRate > 0 && openInterestTrend > 0
          ? "up"
          : fundingData.fundingRate < 0 && openInterestTrend > 0
            ? "neutral"
            : "neutral",
    },
  ]);

  renderTable(
    dom.flowTable,
    [
      {
        label: "Large Buy Flow",
        primary: formatUsd(tradeSummary.bigBuyNotional, 0),
        secondaryLabel: "Large Sell Flow",
        secondary: formatUsd(tradeSummary.bigSellNotional, 0),
        tertiaryLabel: "Net",
        tertiary: formatUsd(tradeSummary.netLargeFlow, 0),
        tone: tradeSummary.netLargeFlow >= 0 ? "up" : "down",
      },
      {
        label: "Aggressive Buy Notional",
        primary: formatUsd(tradeSummary.totalBuyNotional, 0),
        secondaryLabel: "Aggressive Sell Notional",
        secondary: formatUsd(tradeSummary.totalSellNotional, 0),
        tertiaryLabel: "Tape Bias",
        tertiary:
          tradeSummary.totalBuyNotional >= tradeSummary.totalSellNotional
            ? "Buyers active"
            : "Sellers active",
        tone:
          tradeSummary.totalBuyNotional >= tradeSummary.totalSellNotional ? "up" : "down",
      },
    ],
    "Trade flow unavailable"
  );

  renderTable(
    dom.depthTable,
    [
      ...depthSummary.bidWalls.map((wall, index) => ({
        label: `Bid Wall ${index + 1}`,
        primary: formatUsd(wall.price, currentPrice < 1 ? 4 : 2),
        secondaryLabel: "Size",
        secondary: formatCompactNumber(wall.quantity),
        tertiaryLabel: "Notional",
        tertiary: formatUsd(wall.notional, 0),
        tone: "up",
      })),
      ...depthSummary.askWalls.map((wall, index) => ({
        label: `Ask Wall ${index + 1}`,
        primary: formatUsd(wall.price, currentPrice < 1 ? 4 : 2),
        secondaryLabel: "Size",
        secondary: formatCompactNumber(wall.quantity),
        tertiaryLabel: "Notional",
        tertiary: formatUsd(wall.notional, 0),
        tone: "down",
      })),
    ].slice(0, 6),
    "Order-book wall data unavailable"
  );

  renderAnalysisGrid(dom.fundingGrid, [
    {
      label: "Funding Rate",
      value: formatSigned(fundingData.fundingRate, 4, "%"),
      note:
        fundingData.fundingRate > 0
          ? "Longs are paying shorts"
          : fundingData.fundingRate < 0
            ? "Shorts are paying longs"
            : "Balanced perpetual funding",
      tone: toneFromNumber(fundingData.fundingRate, 0.001),
    },
    {
      label: "Mark vs Index",
      value: formatSigned(
        ((fundingData.markPrice - fundingData.indexPrice) / fundingData.indexPrice) * 100,
        3,
        "%"
      ),
      note: "Premium helps show whether futures are trading rich or cheap.",
      tone: toneFromNumber(fundingData.markPrice - fundingData.indexPrice, currentPrice * 0.0005),
    },
    {
      label: "Open Interest Trend",
      value: formatSigned(openInterestTrend, 2, "%"),
      note: "Change over the latest 30 x 5m samples.",
      tone: toneFromNumber(openInterestTrend, 0.2),
    },
    {
      label: "Global Long/Short",
      value: globalLs.toFixed(2),
      note: globalLs > 1 ? "More accounts lean long" : "More accounts lean short",
      tone: toneFromNumber(globalLs - 1, 0.02),
    },
    {
      label: "Top Trader L/S",
      value: topLs.toFixed(2),
      note: topLs > 1 ? "Top accounts lean long" : "Top accounts lean short",
      tone: toneFromNumber(topLs - 1, 0.02),
    },
    {
      label: "Regime Check",
      value: regime.label,
      note: `BTC ${formatPercent(btcChange)} • ETH ${formatPercent(ethChange)}`,
      tone: regime.tone,
    },
  ]);

  renderNews(newsItems);

  dom.outlookSummary.textContent = buildOutlook({
    bias,
    currentPrice,
    supportLevels: supportResistance.supportLevels,
    resistanceLevels: supportResistance.resistanceLevels,
    fundingRate: fundingData.fundingRate,
    imbalance: depthSummary.imbalance,
    largeFlowRatio,
    openInterestTrend,
    nearestBidWall: depthSummary.nearestBidWall,
    nearestAskWall: depthSummary.nearestAskWall,
  });

  setStatus(
    `${symbol} updated on ${new Date().toLocaleString()}. Green cards imply constructive pressure; red cards imply weakening pressure.`,
    bias.tone
  );
}

dom.tokenForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = dom.tokenInput.value || DEFAULT_TOKEN;
  const interval = dom.intervalSelect.value || DEFAULT_INTERVAL;
  try {
    await loadDashboard(token, interval);
  } catch (error) {
    console.error(error);
  }
});

initChart();
loadDashboard(DEFAULT_TOKEN, DEFAULT_INTERVAL).catch((error) => {
  console.error(error);
});
