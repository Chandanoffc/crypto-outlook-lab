/**
 * engine-core.js — shared utilities for all Soloris trading engines.
 *
 * Functions here are identical across house-runtime and tradez-runtime.
 * Extract once, import everywhere — fixes bugs in one place, not two.
 *
 * Intentionally NOT here:
 *   - defaultRuntimeState / sanitizeRuntimeState — state shapes differ per engine
 *   - ema / rsi / atr / sma — different indicator implementations per engine
 *   - isClosingTradeEvent — house uses "tp"/"sl", tradez uses "tp_hit"/"sl_hit"/"break_even_exit"
 *   - hasGoodTradingVolume — house: 100M floor, tradez: 50M floor
 *   - logActivity — activity caps differ (house: 24, tradez: 30)
 *   - getPerpUniverse / fetchUniverseTickers — different filtering / sorting
 *   - analyzeOrderbook — different field weights
 */

"use strict";

const { insertSignalEvent, insertTradeEvent } = require("./neon-db");

// ─── Constants ──────────────────────────────────────────────────────────────

const QUOTE_ASSET = "USDT";

// ─── Number sanitizers ──────────────────────────────────────────────────────

function sanitizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

// ─── Math utilities ─────────────────────────────────────────────────────────

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

// ─── Formatters ─────────────────────────────────────────────────────────────

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

function formatBannerPair(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";
  if (raw.includes("/")) return raw;
  if (raw.endsWith("USDT")) return `${raw.slice(0, -4)}/USDT`;
  if (raw.endsWith("USDC")) return `${raw.slice(0, -4)}/USDC`;
  return raw;
}

// ─── Candle utilities ───────────────────────────────────────────────────────

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

// ─── Market data analysis ───────────────────────────────────────────────────

function analyzeTakerLongShort(entries) {
  const parsed = (entries || []).map((entry) => ({
    buySellRatio: Number(entry.buySellRatio),
  }));
  const latest = parsed[parsed.length - 1];
  return {
    latestRatio: latest?.buySellRatio || 1,
  };
}

// ─── State helpers ───────────────────────────────────────────────────────────

function sanitizeActivityEntry(entry = {}) {
  return {
    time: sanitizeNumber(entry.time, Date.now()),
    message: String(entry.message || "").slice(0, 400),
    tone: entry.tone === "up" || entry.tone === "down" ? entry.tone : "neutral",
  };
}

function updateAlertDeliveryResult(alertDelivery, tone, message) {
  // Callers pass state.alertDelivery directly — mutate it in place.
  alertDelivery.lastResultAt      = Date.now();
  alertDelivery.lastResultMessage = String(message || "").slice(0, 240);
  alertDelivery.lastResultTone    = tone === "up" || tone === "down" ? tone : "neutral";
}

function setRuntimeStatus(state, message, tone = "neutral") {
  state.lastStatusMessage = String(message || "").slice(0, 400);
  state.lastStatusTone = tone === "up" || tone === "down" ? tone : "neutral";
}

// ─── Symbol resolution ───────────────────────────────────────────────────────

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
  return (exchangeInfo.symbols || []).filter((symbolInfo) => {
    if (symbolInfo.quoteAsset !== QUOTE_ASSET) return false;
    if (symbolInfo.contractType !== "PERPETUAL") return false;
    if (symbolInfo.status !== "TRADING") return false;
    const base = symbolInfo.baseAsset || "";
    // Block tokens with non-ASCII characters (meme coins with Chinese/emoji names)
    if (/[^\x00-\x7F]/.test(base)) return false;
    // Block micro-cap tokens with very short base names (< 3 chars, e.g. "X", "AI")
    if (base.replace(/^1000/, "").length < 3) return false;
    return true;
  });
}

// ─── HTTP ───────────────────────────────────────────────────────────────────

async function fetchJson(url, label) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`${label} failed (${response.status})`);
  return response.json();
}

// ─── Database helpers ────────────────────────────────────────────────────────

async function safeInsertSignalEvent(event) {
  try {
    await insertSignalEvent(event);
  } catch (error) {
    // Non-blocking.
  }
}

async function safeInsertTradeEvent(event) {
  try {
    await insertTradeEvent(event);
  } catch (error) {
    // Non-blocking.
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  QUOTE_ASSET,
  // Number sanitizers
  sanitizeNumber,
  nullableNumber,
  nullableTimestamp,
  // Math
  average,
  pctChange,
  pctChangeFromLookback,
  latestDefinedValue,
  // Formatters
  priceDigits,
  formatPrice,
  formatPercent,
  formatBannerPair,
  // Candle utilities
  mapKlineEntry,
  // Market analysis
  analyzeTakerLongShort,
  // State helpers
  sanitizeActivityEntry,
  updateAlertDeliveryResult,
  setRuntimeStatus,
  // Symbol resolution
  scoreSymbolCandidate,
  perpUniverseSymbols,
  // HTTP
  fetchJson,
  // DB helpers
  safeInsertSignalEvent,
  safeInsertTradeEvent,
};
