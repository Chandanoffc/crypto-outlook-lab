"use strict";
const { openTrade } = require("./zencalls-papertrades");;
/**
 * zencalls-strategy.js — automated S/R pivot scanner for ZenCalls.
 *
 * Strategy logic derived from manual ZenCalls chart analysis:
 *   - Computes Monthly (M), Weekly (W), Daily (D) classic pivot points
 *     from Binance OHLCV data (prior period H/L/C)
 *   - Detects 4 bullish setups when price is at/near a pivot support:
 *       1. S/R Bounce     — price at M or W support, bullish close
 *       2. Wedge Breakout — price compressing into M support, then breaking up
 *       3. Base Breakout  — multi-bar tight consolidation above M/W, then breakout
 *       4. W-Bottom       — two equal lows at support, price breaking midpoint
 *   - Calculates TP1 (next pivot up), TP2 (range extension), SL (below pivot)
 *   - Fires Discord embed alert for each match (with cooldown)
 */

const FAPI_BASE = "https://fapi.binance.com";
const PROXIMITY_PCT = 1.5;   // % within which price is "at" a pivot level
const BREAKOUT_PCT  = 0.8;   // % above pivot = confirmed breakout
const MIN_VOLUME_USDT = 500_000; // min 24h volume to avoid illiquid pairs
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h per symbol per side

// ── Binance helpers ───────────────────────────────────────

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function getActiveSymbols() {
  const info = await fetchJson(`${FAPI_BASE}/fapi/v1/exchangeInfo`);
  return info.symbols
    .filter(s => s.status === "TRADING" && s.quoteAsset === "USDT" && s.contractType === "PERPETUAL")
    .map(s => s.symbol);
}

async function get24hVolume() {
  const tickers = await fetchJson(`${FAPI_BASE}/fapi/v1/ticker/24hr`);
  const map = {};
  for (const t of tickers) map[t.symbol] = parseFloat(t.quoteVolume);
  return map;
}

// Fetch klines: interval = "1d" | "1w" | "1M"
async function getKlines(symbol, interval, limit) {
  const data = await fetchJson(
    `${FAPI_BASE}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  );
  return data.map(k => ({
    open:  parseFloat(k[1]),
    high:  parseFloat(k[2]),
    low:   parseFloat(k[3]),
    close: parseFloat(k[4]),
    vol:   parseFloat(k[5]),
    ts:    k[0],
  }));
}

// Classic pivot: PP = (H+L+C)/3, S1 = 2*PP-H, R1 = 2*PP-L, R2 = PP+(H-L)
function calcPivot(candle) {
  const pp = (candle.high + candle.low + candle.close) / 3;
  return {
    pp,
    s1: 2 * pp - candle.high,
    s2: pp - (candle.high - candle.low),
    r1: 2 * pp - candle.low,
    r2: pp + (candle.high - candle.low),
  };
}

function pctDiff(a, b) { return Math.abs(a - b) / b * 100; }
function pctAbove(price, level) { return (price - level) / level * 100; }

// ── Pattern detectors ─────────────────────────────────────

/**
 * 1. S/R Bounce — price sitting at M or W pivot support with bullish close
 */
function detectSRBounce(price, daily, monthly, weekly) {
  for (const [level, label] of [[monthly.s1, "Monthly S1"], [monthly.pp, "Monthly PP"], [weekly.s1, "Weekly S1"], [weekly.pp, "Weekly PP"]]) {
    if (level <= 0) continue;
    if (pctDiff(price, level) <= PROXIMITY_PCT && price > level) {
      const tp1 = weekly.r1 > price ? weekly.r1 : monthly.r1;
      const tp2 = monthly.r2 > tp1  ? monthly.r2 : weekly.r2;
      const sl  = level * 0.985; // 1.5% below pivot
      return { pattern: `S/R Bounce at ${label}`, pivotLevel: level, tp1, tp2, sl };
    }
  }
  return null;
}

/**
 * 2. Wedge Breakout — price was compressing (narrowing range) into support, now breaking up
 */
function detectWedgeBreakout(price, dailyCandles, monthly, weekly) {
  if (dailyCandles.length < 8) return null;
  const recent = dailyCandles.slice(-8);
  // Check range compression: later candles have smaller range than earlier
  const earlyRange = recent.slice(0, 4).reduce((s, c) => s + (c.high - c.low), 0) / 4;
  const lateRange  = recent.slice(4).reduce((s, c) => s + (c.high - c.low), 0) / 4;
  const compressed = lateRange < earlyRange * 0.65;
  if (!compressed) return null;

  // Was compressing near a pivot support?
  const supportBase = Math.min(...recent.map(c => c.low));
  for (const [level, label] of [[monthly.s1, "Monthly S1"], [monthly.pp, "Monthly PP"], [weekly.s1, "Weekly S1"]]) {
    if (level <= 0) continue;
    if (pctDiff(supportBase, level) <= 2.5 && pctAbove(price, level) >= BREAKOUT_PCT) {
      const tp1 = weekly.r1 > price ? weekly.r1 : monthly.r1;
      const tp2 = monthly.r2 > tp1  ? monthly.r2 : tp1 * 1.12;
      const sl  = level * 0.982;
      return { pattern: `Descending Wedge Breakout at ${label}`, pivotLevel: level, tp1, tp2, sl };
    }
  }
  return null;
}

/**
 * 3. Base Breakout — tight multi-bar consolidation above M/W, now breaking out
 */
function detectBaseBreakout(price, dailyCandles, monthly, weekly) {
  if (dailyCandles.length < 10) return null;
  const base = dailyCandles.slice(-10);
  const highs = base.map(c => c.high);
  const lows  = base.map(c => c.low);
  const rangeHigh = Math.max(...highs);
  const rangeLow  = Math.min(...lows);
  const rangeWidth = (rangeHigh - rangeLow) / rangeLow * 100;
  if (rangeWidth > 12) return null; // not tight enough

  // Base must sit on a monthly/weekly support
  for (const [level, label] of [[monthly.pp, "Monthly PP"], [monthly.s1, "Monthly S1"], [weekly.pp, "Weekly PP"]]) {
    if (level <= 0) continue;
    if (pctDiff(rangeLow, level) <= 3 && pctAbove(price, rangeHigh) >= 0.5) {
      const tp1 = rangeHigh * 1.08;
      const tp2 = rangeHigh * 1.20;
      const sl  = level * 0.98;
      return { pattern: `Base Breakout above ${label}`, pivotLevel: level, tp1, tp2, sl };
    }
  }
  return null;
}

/**
 * 4. W-Bottom — two roughly equal lows at support, price breaking the neckline midpoint
 */
function detectWBottom(price, dailyCandles, monthly, weekly) {
  if (dailyCandles.length < 12) return null;
  const c = dailyCandles.slice(-12);
  // Find two lowest candles
  const sorted = [...c].sort((a, b) => a.low - b.low);
  const low1 = sorted[0].low;
  const low2 = sorted[1].low;
  if (pctDiff(low1, low2) > 3) return null; // lows must be close
  const neckline = Math.max(...c.map(k => k.high)) * 0.97;
  if (price < neckline) return null; // must be breaking neckline

  for (const [level, label] of [[monthly.s1, "Monthly S1"], [monthly.pp, "Monthly PP"], [weekly.s1, "Weekly S1"]]) {
    if (level <= 0) continue;
    if (pctDiff(low1, level) <= 3) {
      const tp1 = neckline * 1.06;
      const tp2 = neckline * 1.15;
      const sl  = low1 * 0.982;
      return { pattern: `W-Bottom at ${label}`, pivotLevel: level, tp1, tp2, sl };
    }
  }
  return null;
}

// ── Discord alert ─────────────────────────────────────────

async function sendZenAlert(webhook, signal) {
  if (!webhook) return;
  const { symbol, pattern, entry, tp1, tp2, sl } = signal;
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: `🟢 LONG · ${symbol} — ZenCalls Signal`,
          color: 0xa78bfa,
          fields: [
            { name: "Pattern",  value: pattern, inline: false },
            { name: "Entry",    value: String(entry.toPrecision(6)),  inline: true },
            { name: "TP1",      value: String(tp1.toPrecision(6)),    inline: true },
            { name: "TP2",      value: String(tp2.toPrecision(6)),    inline: true },
            { name: "SL",       value: String(sl.toPrecision(6)),     inline: true },
            { name: "R:R",      value: `1 : ${((tp1 - entry) / (entry - sl)).toFixed(2)}`, inline: true },
          ],
          footer: { text: "ZenCalls Strategy Scanner" },
          timestamp: new Date().toISOString(),
        }],
      }),
    });
  } catch { /* non-fatal */ }
}

// ── Main scan ─────────────────────────────────────────────

const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // min gap between alerts for same symbol

function defaultState() {
  return { alerts: {}, signals: [], lastScan: 0 };
}

const SCAN_BATCH = 15; // parallel symbols per batch
// Signals older than this are silently expired on the next scan so stale guards
// don't block re-detection indefinitely. 48h gives enough time to catch TP/SL
// without creating a 7-day "all signals expire together" blast when paper trades time out.
const SIGNAL_TTL_MS = 48 * 60 * 60 * 1000;

async function scanSymbol(symbol, price, daily, weekly, monthly, dailyK, state, now, webhook, acc, ptState) {
  // Silently expire signals older than SIGNAL_TTL_MS so stale guards don't
  // block detection forever. Expiry here does NOT fire a Discord alert.
  const existingIdx = (state.signals || []).findIndex(s => s.symbol === symbol && s.status === "active");
  if (existingIdx !== -1) {
    const existing = state.signals[existingIdx];
    if (now - existing.detectedAt < SIGNAL_TTL_MS) return; // still fresh — skip
    // Silently expire — just remove it so re-detection can proceed below
    state.signals.splice(existingIdx, 1);
  }

  const hit =
    detectSRBounce(price, daily, monthly, weekly) ||
    detectWedgeBreakout(price, dailyK, monthly, weekly) ||
    detectBaseBreakout(price, dailyK, monthly, weekly) ||
    detectWBottom(price, dailyK, monthly, weekly);

  if (hit && hit.tp1 > price && hit.sl < price) {
    const rr = (hit.tp1 - price) / (price - hit.sl);
    if (rr < 1.0) return;

    // Per-symbol cooldown: don't re-alert the same symbol within 6h of its last alert,
    // even if the TTL expired and the pattern is still technically valid.
    const lastAlertedAt = (state.alerts || {})[symbol] || 0;
    if (now - lastAlertedAt < ALERT_COOLDOWN_MS) return;

    const signal = {
      id: `${symbol}-${now}`,
      symbol,
      side: "long",
      entry: price,
      tp1: hit.tp1,
      tp2: hit.tp2,
      sl: hit.sl,
      pattern: hit.pattern,
      rr: Math.round(rr * 100) / 100,
      detectedAt: now,
      status: "active",
    };

    state.signals = [signal, ...state.signals.filter(s => s.symbol !== symbol)].slice(0, 100);
    if (!state.alerts) state.alerts = {};
    state.alerts[symbol] = now; // track last alert time for per-symbol cooldown
    await sendZenAlert(webhook, signal);
    acc.signals++;
    // Auto-open paper trade for every new signal
    if (ptState) openTrade(ptState, signal);
  }
}

async function processSymbol(symbol, state, now, webhook, acc) {
  try {
    const [dailyK, weeklyK, monthlyK] = await Promise.all([
      getKlines(symbol, "1d", 12),
      getKlines(symbol, "1w", 4),
      getKlines(symbol, "1M", 3),
    ]);
    if (dailyK.length < 2 || weeklyK.length < 2 || monthlyK.length < 2) return;

    const dailyPivot   = calcPivot(dailyK[dailyK.length - 2]);
    const weeklyPivot  = calcPivot(weeklyK[weeklyK.length - 2]);
    const monthlyPivot = calcPivot(monthlyK[monthlyK.length - 2]);
    const price        = dailyK[dailyK.length - 1].close;

    await scanSymbol(symbol, price, dailyPivot, weeklyPivot, monthlyPivot, dailyK, state, now, webhook, acc, acc.ptState);
  } catch (e) {
    acc.errors.push(`${symbol}: ${e.message}`);
  }
}

async function runZenStrategy_Scan(state, { webhook, ptState } = {}) {
  const now = Date.now();
  if (!state.alerts)  state.alerts  = {};
  if (!state.signals) state.signals = [];

  let symbols;
  try { symbols = await getActiveSymbols(); } catch { return { signals: 0, error: "exchangeInfo failed" }; }

  let volumeMap;
  try { volumeMap = await get24hVolume(); } catch { volumeMap = {}; }

  symbols = symbols.filter(s => (volumeMap[s] || 0) >= MIN_VOLUME_USDT);

  const acc = { signals: 0, errors: [], ptState };

  // Process in parallel batches to stay well within Vercel's 60s timeout
  for (let i = 0; i < symbols.length; i += SCAN_BATCH) {
    const batch = symbols.slice(i, i + SCAN_BATCH);
    await Promise.all(batch.map(sym => processSymbol(sym, state, now, webhook, acc)));
  }

  state.lastScan = now;
  return { signals: acc.signals, symbolsScanned: symbols.length, errors: acc.errors.slice(0, 5) };
}

module.exports = { runZenStrategy_Scan, defaultState };
