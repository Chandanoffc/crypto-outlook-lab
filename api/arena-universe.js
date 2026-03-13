const fallbackExchangeInfo = require("../fallback-perps.js");

const QUOTE_ASSET = "USDT";
const EXCHANGE_CACHE_TTL_MS = 10 * 60 * 1000;
const TICKER_CACHE_TTL_MS = 20 * 1000;

let exchangeInfoCache = {
  data: null,
  expiresAt: 0,
};

let tickerCache = {
  payload: null,
  expiresAt: 0,
};

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

  let data;
  try {
    data = await fetchJson(
      "https://fapi.binance.com/fapi/v1/exchangeInfo",
      "Futures exchange info"
    );
  } catch (error) {
    if (!Array.isArray(fallbackExchangeInfo.symbols) || !fallbackExchangeInfo.symbols.length) {
      throw error;
    }
    data = fallbackExchangeInfo;
  }

  exchangeInfoCache = {
    data,
    expiresAt: Date.now() + EXCHANGE_CACHE_TTL_MS,
  };

  return data;
}

function getActiveSymbols(exchangeInfo) {
  return (exchangeInfo.symbols || [])
    .filter(
      (symbolInfo) =>
        symbolInfo.quoteAsset === QUOTE_ASSET &&
        symbolInfo.contractType === "PERPETUAL" &&
        symbolInfo.status === "TRADING"
    )
    .map((symbolInfo) => symbolInfo.symbol);
}

function mapTickerEntries(entries, activeSymbols) {
  return (entries || [])
    .filter((entry) => activeSymbols.has(entry.symbol))
    .map((entry) => ({
      symbol: entry.symbol,
      lastPrice: Number(entry.lastPrice ?? entry.price ?? entry.markPrice) || 0,
      changePct: Number(entry.priceChangePercent) || 0,
      quoteVolume: Number(entry.quoteVolume) || 0,
      volume: Number(entry.volume) || 0,
    }));
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

module.exports = async function handler(_req, res) {
  if (tickerCache.payload && Date.now() < tickerCache.expiresAt) {
    buildJsonResponse(res, 200, tickerCache.payload);
    return;
  }

  try {
    const exchangeInfo = await getExchangeInfo();
    const activeSymbols = new Set(getActiveSymbols(exchangeInfo));
    let tickers = [];
    let source = "server 24H proxy";
    let degraded = false;
    let warning = "";

    try {
      const rawTickers = await fetchJson(
        "https://fapi.binance.com/fapi/v1/ticker/24hr",
        "24H tickers"
      );
      tickers = mapTickerEntries(rawTickers, activeSymbols);
    } catch (bulkError) {
      degraded = true;
      warning = bulkError.message || "24H tickers unavailable";
      source = "server price proxy";

      try {
        const rawPrices = await fetchJson(
          "https://fapi.binance.com/fapi/v1/ticker/price",
          "Ticker prices"
        );
        tickers = mapTickerEntries(rawPrices, activeSymbols);
      } catch (priceError) {
        degraded = true;
        warning = priceError.message || warning;
        source = "server shell universe";
        tickers = buildShellTickers(activeSymbols);
      }
    }

    const payload = {
      tickers,
      source,
      degraded,
      warning,
      generatedAt: Date.now(),
    };

    tickerCache = {
      payload,
      expiresAt: Date.now() + TICKER_CACHE_TTL_MS,
    };

    buildJsonResponse(res, 200, payload);
  } catch (error) {
    buildJsonResponse(res, 502, {
      error: error.message || "Arena universe feed failed.",
    });
  }
};
