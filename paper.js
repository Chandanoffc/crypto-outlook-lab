const START_BALANCE = 200;
const DEFAULT_INTERVAL = "15m";
const DEFAULT_WATCHLIST = "BTC,ETH,SOL,BNB,XRP";
const DEFAULT_QUALITY_THRESHOLD = 68;
const QUOTE_ASSET = "USDT";
const AUTO_SCAN_MS = 90 * 1000;
const STORAGE_KEY = "apex-signals-auto-paper";

const dom = {
  autoForm: document.getElementById("auto-form"),
  watchlistInput: document.getElementById("watchlist-input"),
  scanInterval: document.getElementById("scan-interval"),
  qualityThreshold: document.getElementById("quality-threshold"),
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
  engineSummary: document.getElementById("engine-summary"),
  candidateGrid: document.getElementById("candidate-grid"),
  openPositionGrid: document.getElementById("open-position-grid"),
  tradeLogTable: document.getElementById("trade-log-table"),
  activityTable: document.getElementById("activity-table"),
};

const state = loadState();
let autoTimer = null;
let exchangeInfoCache = null;
let scanning = false;

function loadState() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      startingBalance: START_BALANCE,
      balance: Number(stored.balance) || START_BALANCE,
      autoEnabled: stored.autoEnabled !== false,
      watchlist: stored.watchlist || DEFAULT_WATCHLIST,
      interval: stored.interval || DEFAULT_INTERVAL,
      qualityThreshold: Number(stored.qualityThreshold) || DEFAULT_QUALITY_THRESHOLD,
      openTrade: stored.openTrade || null,
      closedTrades: Array.isArray(stored.closedTrades) ? stored.closedTrades : [],
      activity: Array.isArray(stored.activity) ? stored.activity : [],
      lastCandidates: Array.isArray(stored.lastCandidates) ? stored.lastCandidates : [],
      lastScanAt: Number(stored.lastScanAt) || 0,
    };
  } catch (error) {
    return {
      startingBalance: START_BALANCE,
      balance: START_BALANCE,
      autoEnabled: true,
      watchlist: DEFAULT_WATCHLIST,
      interval: DEFAULT_INTERVAL,
      qualityThreshold: DEFAULT_QUALITY_THRESHOLD,
      openTrade: null,
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
      autoEnabled: state.autoEnabled,
      watchlist: state.watchlist,
      interval: state.interval,
      qualityThreshold: state.qualityThreshold,
      openTrade: state.openTrade,
      closedTrades: state.closedTrades,
      activity: state.activity,
      lastCandidates: state.lastCandidates,
      lastScanAt: state.lastScanAt,
    })
  );
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

function normalizeWatchlist(rawWatchlist) {
  return Array.from(
    new Set(
      String(rawWatchlist || "")
        .split(",")
        .map((token) => normalizeToken(token))
        .filter(Boolean)
    )
  ).slice(0, 8);
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
    summary: `${bias.label} bias • Q${qualityScore} • RR ${rr.toFixed(2)} • funding ${fundingRate.toFixed(4)}%`,
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
  exchangeInfoCache = await fetchJson("https://fapi.binance.com/fapi/v1/exchangeInfo", "Exchange info");
  return exchangeInfoCache;
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
    fetchJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${resolved.symbol}`, "Open interest"),
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
    openInterestResult,
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
    openInterest: openInterestResult.status === "fulfilled" ? openInterestResult.value : null,
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

function logActivity(message, tone = "neutral") {
  state.activity.unshift({
    time: Date.now(),
    message,
    tone,
  });
  state.activity = state.activity.slice(0, 24);
}

function openTradeFromCandidate(candidate) {
  const balanceBefore = state.balance;
  const riskCapital = Math.max(balanceBefore * 0.02, 2);
  const maxMargin = balanceBefore * 0.35;
  const leverage = 2.5;
  const stopDistance = Math.abs(candidate.trade.entry - candidate.trade.stopLoss);
  const quantityByRisk = stopDistance > 0 ? riskCapital / stopDistance : 0;
  const quantityByCapital = (maxMargin * leverage) / candidate.trade.entry;
  const quantity = Math.max(0, Math.min(quantityByRisk, quantityByCapital));

  if (!Number.isFinite(quantity) || quantity <= 0) return;

  state.openTrade = {
    id: `${Date.now()}-${candidate.symbol}`,
    symbol: candidate.symbol,
    token: candidate.token,
    interval: state.interval,
    side: candidate.trade.stance,
    entryPrice: candidate.trade.entry,
    stopLoss: candidate.trade.stopLoss,
    takeProfit: candidate.trade.takeProfit,
    quantity,
    leverage,
    marginUsed: maxMargin,
    qualityScore: candidate.qualityScore,
    biasScore: candidate.biasScore,
    openedAt: Date.now(),
    balanceBefore,
    lastPrice: candidate.currentPrice,
  };

  logActivity(
    `Opened ${candidate.trade.stance} ${candidate.symbol} at ${formatPrice(candidate.trade.entry, candidate.pricePrecision)} with quality ${candidate.qualityScore}.`,
    candidate.trade.tone
  );
}

function closeOpenTrade(reason, exitPrice, precisionHint) {
  if (!state.openTrade) return;
  const direction = state.openTrade.side === "Short" ? -1 : 1;
  const pnlUsd = (exitPrice - state.openTrade.entryPrice) * state.openTrade.quantity * direction;
  const pnlPct = pctChange(state.openTrade.entryPrice, exitPrice) * direction;
  const balanceAfter = state.balance + pnlUsd;

  state.closedTrades.unshift({
    id: state.openTrade.id,
    symbol: state.openTrade.symbol,
    side: state.openTrade.side,
    entryPrice: state.openTrade.entryPrice,
    exitPrice,
    stopLoss: state.openTrade.stopLoss,
    takeProfit: state.openTrade.takeProfit,
    openedAt: state.openTrade.openedAt,
    closedAt: Date.now(),
    reason,
    pnlUsd,
    pnlPct,
    balanceBefore: state.openTrade.balanceBefore,
    balanceAfter,
    quantity: state.openTrade.quantity,
  });
  state.closedTrades = state.closedTrades.slice(0, 60);
  state.balance = balanceAfter;
  logActivity(
    `${reason} closed ${state.openTrade.side} ${state.openTrade.symbol} at ${formatPrice(
      exitPrice,
      precisionHint
    )} for ${formatPercent(pnlPct)} and ${formatCompactUsd(pnlUsd, 2)}.`,
    reason === "TP" ? "up" : "down"
  );
  state.openTrade = null;
}

function refreshOpenTrade(candidate) {
  if (!state.openTrade || !candidate) return;
  state.openTrade.lastPrice = candidate.currentPrice;
  const hitTarget =
    state.openTrade.side === "Long"
      ? candidate.currentPrice >= state.openTrade.takeProfit
      : candidate.currentPrice <= state.openTrade.takeProfit;
  const hitStop =
    state.openTrade.side === "Long"
      ? candidate.currentPrice <= state.openTrade.stopLoss
      : candidate.currentPrice >= state.openTrade.stopLoss;

  if (hitTarget) closeOpenTrade("TP", state.openTrade.takeProfit, candidate.pricePrecision);
  else if (hitStop) closeOpenTrade("SL", state.openTrade.stopLoss, candidate.pricePrecision);
}

function summarizeEngine(candidates, threshold) {
  const qualified = highQualityCandidates(candidates, threshold);
  if (state.openTrade) {
    return `${state.openTrade.symbol} is currently open, so the engine is only monitoring exits. ${qualified.length} fresh candidates still meet the quality filter, but the simulator stays one-position-at-a-time.`;
  }
  if (!qualified.length) {
    return `No watchlist token currently meets the quality threshold of ${threshold}. The engine is waiting for stronger alignment across trend, order flow, leverage, and risk/reward.`;
  }
  const best = qualified[0];
  return `${qualified.length} high-quality setups were found. ${best.symbol} is leading with quality ${best.qualityScore}, ${best.bias.label.toLowerCase()} bias, and ${best.rr.toFixed(2)}R projected reward to TP.`;
}

function renderDashboard() {
  const realizedPnl = state.balance - state.startingBalance;
  const winCount = state.closedTrades.filter((trade) => trade.reason === "TP").length;
  const totalClosed = state.closedTrades.length;
  const winRate = totalClosed ? (winCount / totalClosed) * 100 : 0;
  const openTrade = state.openTrade;
  const unrealizedPct =
    openTrade && Number.isFinite(openTrade.lastPrice)
      ? pctChange(openTrade.entryPrice, openTrade.lastPrice) * (openTrade.side === "Short" ? -1 : 1)
      : 0;

  dom.metricStartBalance.textContent = formatPrice(state.startingBalance, 2);
  dom.metricCurrentEquity.textContent = formatPrice(state.balance, 2);
  dom.metricCurrentEquity.className = toneFromNumber(realizedPnl, 0.01);
  dom.metricCurrentNote.textContent = openTrade
    ? `Open ${openTrade.side} ${openTrade.symbol} • unrealized ${formatPercent(unrealizedPct)}`
    : "No open position";
  dom.metricRealizedPnl.textContent = formatCompactUsd(realizedPnl, 2);
  dom.metricRealizedPnl.className = toneFromNumber(realizedPnl, 0.01);
  dom.metricRealizedNote.textContent = `${formatPercent(pctChange(state.startingBalance, state.balance))} vs start`;
  dom.metricWinRate.textContent = `${winRate.toFixed(0)}%`;
  dom.metricWinRate.className = toneFromNumber(winRate - 50, 2);
  dom.metricWinRateNote.textContent = `${winCount} winners / ${totalClosed} closed trades`;
  dom.metricOpenTrade.textContent = openTrade ? `${openTrade.side} ${openTrade.symbol}` : "None";
  dom.metricOpenTrade.className = openTrade ? (openTrade.side === "Long" ? "up" : "down") : "neutral";
  dom.metricOpenNote.textContent = openTrade
    ? `Entry ${formatPrice(openTrade.entryPrice, 2)} • TP ${formatPrice(openTrade.takeProfit, 2)} • SL ${formatPrice(openTrade.stopLoss, 2)}`
    : "Waiting for a high-quality setup";
  dom.metricLastScan.textContent = state.lastScanAt
    ? new Date(state.lastScanAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "-";
  dom.metricLastScanNote.textContent = state.autoEnabled
    ? "Auto engine armed"
    : "Auto engine paused";

  dom.engineSummary.textContent = summarizeEngine(state.lastCandidates, state.qualityThreshold);

  const candidateCards = state.lastCandidates.slice(0, 6).map((candidate) => ({
    label: candidate.symbol,
    value: `${candidate.bias.label} • Q${candidate.qualityScore}`,
    note: `${formatPrice(candidate.currentPrice, candidate.pricePrecision)} • RR ${candidate.rr.toFixed(2)} • CVD ${formatPercent(candidate.cvdSlope)} • OI ${formatPercent(candidate.oiChange1h)}`,
    tone: candidate.bias.tone,
  }));
  renderAnalysisGrid(
    dom.candidateGrid,
    candidateCards.length
      ? candidateCards
      : [
          {
            label: "Scanner",
            value: "Waiting",
            note: "No candidate snapshot is available yet.",
            tone: "neutral",
          },
        ]
  );

  renderAnalysisGrid(
    dom.openPositionGrid,
    openTrade
      ? [
          {
            label: `${openTrade.symbol} ${openTrade.side}`,
            value: formatPrice(openTrade.lastPrice || openTrade.entryPrice, 2),
            note: `Entry ${formatPrice(openTrade.entryPrice, 2)} • TP ${formatPrice(openTrade.takeProfit, 2)} • SL ${formatPrice(openTrade.stopLoss, 2)}`,
            tone: openTrade.side === "Long" ? "up" : "down",
          },
          {
            label: "Unrealized %",
            value: formatPercent(unrealizedPct),
            note: `Qty ${formatCompactNumber(openTrade.quantity, 3)} • leverage ${openTrade.leverage}x`,
            tone: toneFromNumber(unrealizedPct, 0.02),
          },
          {
            label: "Margin Used",
            value: formatPrice(openTrade.marginUsed, 2),
            note: `Quality ${openTrade.qualityScore} • bias ${openTrade.biasScore}`,
            tone: "neutral",
          },
        ]
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
      label: `${trade.symbol} • ${trade.reason}`,
      primary: `${formatPrice(trade.entryPrice, 2)} -> ${formatPrice(trade.exitPrice, 2)}`,
      secondaryLabel: "Outcome",
      secondary: `${formatPercent(trade.pnlPct)} • ${formatCompactUsd(trade.pnlUsd, 2)}`,
      tertiaryLabel: "Balance",
      tertiary: formatPrice(trade.balanceAfter, 2),
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
    ? "Auto-scans every 90 seconds."
    : "Auto engine paused. Manual scans still work.";
}

async function scanWatchlist({ manual = false } = {}) {
  if (scanning) return;
  scanning = true;
  const tokens = normalizeWatchlist(state.watchlist);
  setStatus(`Scanning ${tokens.join(", ")} for high-quality trades...`, "neutral");

  try {
    const results = await Promise.allSettled(
      tokens.map(async (token) => analyzeSnapshot(await fetchSnapshotWithFallback(token, state.interval)))
    );
    const candidates = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value)
      .sort((left, right) => right.qualityScore - left.qualityScore);

    state.lastCandidates = candidates;
    state.lastScanAt = Date.now();

    if (state.openTrade) {
      const matching = candidates.find((candidate) => candidate.symbol === state.openTrade.symbol);
      if (matching) refreshOpenTrade(matching);
    }

    if (!state.openTrade) {
      const qualified = highQualityCandidates(candidates, state.qualityThreshold);
      if (qualified.length) {
        openTradeFromCandidate(qualified[0]);
        setStatus(`${qualified[0].symbol} qualified and was opened automatically.`, qualified[0].bias.tone);
      } else {
        if (manual) logActivity(`Manual scan found no setup above quality ${state.qualityThreshold}.`, "neutral");
        setStatus(`No trade opened. Waiting for quality >= ${state.qualityThreshold}.`, "neutral");
      }
    } else {
      setStatus(`Monitoring open ${state.openTrade.side} ${state.openTrade.symbol} for TP or SL.`, state.openTrade.side === "Long" ? "up" : "down");
    }

    persistState();
    renderDashboard();
  } catch (error) {
    setStatus(error.message || "Auto trader scan failed.", "down");
    logActivity(error.message || "Auto trader scan failed.", "down");
    persistState();
    renderDashboard();
  } finally {
    scanning = false;
  }
}

function scheduleAutoScan() {
  if (autoTimer) window.clearInterval(autoTimer);
  autoTimer = null;
  if (!state.autoEnabled) return;
  autoTimer = window.setInterval(() => {
    scanWatchlist();
  }, AUTO_SCAN_MS);
}

function syncControls() {
  dom.watchlistInput.value = state.watchlist;
  dom.scanInterval.value = state.interval;
  dom.qualityThreshold.value = `${state.qualityThreshold}`;
}

dom.autoForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.watchlist = dom.watchlistInput.value || DEFAULT_WATCHLIST;
  state.interval = dom.scanInterval.value || DEFAULT_INTERVAL;
  state.qualityThreshold = Math.max(50, Number(dom.qualityThreshold.value) || DEFAULT_QUALITY_THRESHOLD);
  persistState();
  scanWatchlist({ manual: true });
});

dom.autoToggleButton.addEventListener("click", () => {
  state.autoEnabled = !state.autoEnabled;
  persistState();
  scheduleAutoScan();
  renderDashboard();
  setStatus(state.autoEnabled ? "Auto paper trader resumed." : "Auto paper trader paused.", state.autoEnabled ? "up" : "neutral");
});

dom.resetSimButton.addEventListener("click", () => {
  state.balance = START_BALANCE;
  state.openTrade = null;
  state.closedTrades = [];
  state.activity = [];
  state.lastCandidates = [];
  state.lastScanAt = 0;
  logActivity("Simulation reset to $200.", "neutral");
  persistState();
  renderDashboard();
  setStatus("Simulation reset to $200.", "neutral");
});

syncControls();
renderDashboard();
scheduleAutoScan();
scanWatchlist();
