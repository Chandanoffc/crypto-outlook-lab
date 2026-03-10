const DEFAULT_TOKEN = "BTC";
const DEFAULT_INTERVAL = "15m";
const QUOTE_ASSET = "USDT";
const NEWS_LIMIT = 6;
const VALID_INTERVALS = new Set(["5m", "15m", "1h", "4h"]);
const EXCHANGE_CACHE_TTL_MS = 10 * 60 * 1000;

let exchangeInfoCache = {
  data: null,
  expiresAt: 0,
};

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
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

function buildJsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=60");
  res.end(JSON.stringify(payload));
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

async function getExchangeInfo() {
  if (exchangeInfoCache.data && Date.now() < exchangeInfoCache.expiresAt) {
    return exchangeInfoCache.data;
  }

  const data = await fetchJson(
    "https://fapi.binance.com/fapi/v1/exchangeInfo",
    "Futures exchange info"
  );

  exchangeInfoCache = {
    data,
    expiresAt: Date.now() + EXCHANGE_CACHE_TTL_MS,
  };

  return data;
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
  const suggestions = ranked.slice(0, 6).map((entry) => entry.symbolInfo.symbol);

  if (!resolved) {
    return {
      cleanedToken,
      suggestions,
      error: `No USDT perpetual contract found for "${cleanedToken}".`,
    };
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

function transformCandle(entry) {
  return {
    time: Math.floor(entry[0] / 1000),
    open: Number(entry[1]),
    high: Number(entry[2]),
    low: Number(entry[3]),
    close: Number(entry[4]),
    volume: Number(entry[5]),
  };
}

module.exports = async function handler(req, res) {
  const token = firstQueryValue(req.query?.token) || DEFAULT_TOKEN;
  const interval = firstQueryValue(req.query?.interval) || DEFAULT_INTERVAL;

  if (!VALID_INTERVALS.has(interval)) {
    buildJsonResponse(res, 400, {
      error: `Unsupported interval "${interval}".`,
      validIntervals: Array.from(VALID_INTERVALS),
    });
    return;
  }

  try {
    const exchangeInfo = await getExchangeInfo();
    const resolved = resolvePerpSymbol(token, exchangeInfo);

    if (!resolved.symbol) {
      buildJsonResponse(res, 404, {
        error: resolved.error,
        suggestions: resolved.suggestions,
      });
      return;
    }

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
      fetchJson(
        `https://fapi.binance.com/fapi/v1/klines?symbol=${resolved.symbol}&interval=${interval}&limit=240`,
        "Perps klines"
      ),
      fetchJson(
        `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${resolved.symbol}`,
        "Perps 24H ticker"
      ),
      fetchJson(
        `https://fapi.binance.com/fapi/v1/depth?symbol=${resolved.symbol}&limit=100`,
        "Perps orderbook"
      ),
      fetchJson(
        `https://fapi.binance.com/fapi/v1/aggTrades?symbol=${resolved.symbol}&limit=400`,
        "Perps agg trades"
      ),
      fetchJson(
        `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${resolved.symbol}`,
        "Premium index"
      ),
      fetchJson(
        `https://fapi.binance.com/fapi/v1/openInterest?symbol=${resolved.symbol}`,
        "Open interest"
      ),
      fetchJson(
        `https://fapi.binance.com/futures/data/openInterestHist?symbol=${resolved.symbol}&period=5m&limit=60`,
        "Open interest history"
      ),
      fetchJson(
        `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${resolved.symbol}&period=1h&limit=24`,
        "Global long short ratio"
      ),
      fetchJson(
        `https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${resolved.symbol}&period=1h&limit=24`,
        "Top trader long short ratio"
      ),
      fetchJson(
        `https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${resolved.symbol}&period=5m&limit=24`,
        "Taker long short ratio"
      ),
      fetchJson(
        "https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT",
        "BTC context"
      ),
      fetchJson(
        "https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=ETHUSDT",
        "ETH context"
      ),
      fetchJson(
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
      buildJsonResponse(res, 502, {
        error: `Core perpetual market data is unavailable for ${resolved.symbol}.`,
      });
      return;
    }

    buildJsonResponse(res, 200, {
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
      candles: klinesResult.value.map(transformCandle),
      ticker: tickerResult.value,
      depth: depthResult.status === "fulfilled" ? depthResult.value : { bids: [], asks: [] },
      trades: tradesResult.status === "fulfilled" ? tradesResult.value : [],
      premiumIndex:
        premiumIndexResult.status === "fulfilled" ? premiumIndexResult.value : null,
      openInterest:
        openInterestResult.status === "fulfilled" ? openInterestResult.value : null,
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
          ? newsResult.value.Data.slice(0, NEWS_LIMIT)
          : [],
    });
  } catch (error) {
    buildJsonResponse(res, 500, {
      error: error.message || "Failed to build perps market snapshot.",
    });
  }
};
