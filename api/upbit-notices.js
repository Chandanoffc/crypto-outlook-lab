"use strict";

/**
 * upbit-notices.js
 *
 * Uses the official Upbit market API (api.upbit.com/v1/market/all) instead of
 * HTML scraping.  The notice page is a pure SPA — there is no server-rendered
 * data to parse.  The market/all API returns all listed markets as clean JSON
 * and is the authoritative source for new listing detection.
 *
 * New-listing detection works by comparing the current market set against a
 * previously stored snapshot in NeonDB.  Any KRW-* market that appears in
 * the current list but not in the stored snapshot is a new listing.
 */

const UPBIT_MARKET_API = "https://api.upbit.com/v1/market/all?isDetails=false";
const UPBIT_NOTICE_PAGE = "https://www.upbit.com/service_center/notice";
const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60 * 1000;

let marketCache = { data: null, expiresAt: 0 };

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Market list ─────────────────────────────────────────────────────────────

/**
 * Returns the current full market list from Upbit's official API.
 * Each entry: { market, korean_name, english_name }
 * e.g. { market: "KRW-BTC", korean_name: "비트코인", english_name: "Bitcoin" }
 */
async function getUpbitMarkets() {
  if (marketCache.data && Date.now() < marketCache.expiresAt) {
    return marketCache.data;
  }

  const response = await fetchWithTimeout(UPBIT_MARKET_API, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; upbit-monitor/1.0)",
    },
  });

  const markets = await response.json();
  if (!Array.isArray(markets)) throw new Error("Unexpected market/all response format");

  marketCache = { data: markets, expiresAt: Date.now() + CACHE_TTL_MS };
  return markets;
}

/**
 * Returns only KRW-quoted markets (the primary Upbit listing market).
 */
function krwMarkets(markets) {
  return markets.filter(m => typeof m.market === "string" && m.market.startsWith("KRW-"));
}

/**
 * Build a listing event object (compatible shape with what upbit-cron expects).
 */
function buildListingEvent(market) {
  const ticker = market.market.replace("KRW-", "");
  const tokenName = market.english_name || market.korean_name || ticker;
  const tokenLabel = `${tokenName} (${ticker})`;
  return {
    id: market.market,
    market: market.market,
    ticker,
    tokenName,
    tokenLabel,
    title: `Market Support for ${tokenLabel}`,
    url: `${UPBIT_NOTICE_PAGE}`,
    isMarketSupport: true,
    isNewListing: true,
    detectedAt: Date.now(),
    source: "Upbit Market API",
  };
}

// ─── Diff helper (called by upbit-cron) ──────────────────────────────────────

/**
 * Given a stored Set/Array of previously known market IDs and the current
 * market list, returns listing-event objects for any brand-new KRW markets.
 */
function findNewListings(currentMarkets, knownMarketIds) {
  const knownSet = new Set(Array.isArray(knownMarketIds) ? knownMarketIds : []);
  return krwMarkets(currentMarkets)
    .filter(m => !knownSet.has(m.market))
    .map(buildListingEvent);
}

// ─── HTTP handler (for /api/upbit-notices route) ──────────────────────────────

async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
  try {
    const markets = await getUpbitMarkets();
    const krw = krwMarkets(markets);
    res.statusCode = 200;
    res.end(JSON.stringify({
      total: markets.length,
      krwCount: krw.length,
      krwMarkets: krw.slice(0, 20).map(m => ({
        market: m.market,
        english_name: m.english_name,
        korean_name: m.korean_name,
      })),
    }));
  } catch (err) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: err.message || "Unable to fetch Upbit markets." }));
  }
}

module.exports = handler;
module.exports.getUpbitMarkets = getUpbitMarkets;
module.exports.krwMarkets = krwMarkets;
module.exports.findNewListings = findNewListings;
