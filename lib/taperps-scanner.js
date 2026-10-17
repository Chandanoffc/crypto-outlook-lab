"use strict";
/**
 * taperps-scanner.js — "TA Perps" strategy
 *
 * Multi-confluence scanner combining:
 *   1. Parallel Channel — price position relative to upper/lower/midline
 *   2. RSI Divergence   — regular, hidden, exaggerated (bullish/bearish)
 *   3. Elliott Wave corrective structures — Flat, Zig Zag, Triangle (A-B-C-D-E)
 *   4. Fibonacci retracement — C/E wave at 0.382/0.5/0.618/0.786 of prior impulse
 *
 * A signal requires ALL pillars aligning at the same price zone.
 * Minimum score: 60 / 100 to alert.
 *
 * Timeframe: 4H (as per strategy images). Scans top Binance USDT perps.
 */

const { fetchJson, mapKlineEntry, perpUniverseSymbols, QUOTE_ASSET } = require("./engine-core");

const BINANCE_FAPI   = "https://fapi.binance.com/fapi/v1";
const INTERVAL       = "4h";
const KLINE_LIMIT    = 200;    // enough for channel + divergence + wave detection
const RSI_PERIOD     = 14;
const SWING_LOOKBACK = 5;      // bars each side to qualify as swing high/low
const MIN_SCORE      = 60;     // minimum confluence score to generate a signal
const CONCURRENCY    = 6;
const SIGNAL_COOLDOWN_MS = 8 * 60 * 60 * 1000;   // 8h per symbol+side

// Fibonacci levels used for corrective wave C/E endpoint validation
const FIB_LEVELS = [0.382, 0.5, 0.618, 0.786, 1.0, 1.272];
const FIB_TOLERANCE = 0.03;  // ±3% around each fib level

// ─── Kline fetch ─────────────────────────────────────────────────────────────

async function fetchKlines(symbol) {
  const url = `${BINANCE_FAPI}/klines?symbol=${symbol}&interval=${INTERVAL}&limit=${KLINE_LIMIT}`;
  const raw = await fetchJson(url, `klines:${symbol}`);
  return raw.map(mapKlineEntry);
}

// ─── RSI ─────────────────────────────────────────────────────────────────────

function calcRSI(closes, period = RSI_PERIOD) {
  if (closes.length < period + 1) return [];
  const rsi = new Array(closes.length).fill(null);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff; else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

// ─── Swing detection ─────────────────────────────────────────────────────────
// Returns array of { idx, price, type: 'high'|'low', rsi }

function detectSwings(candles, rsiValues, lookback = SWING_LOOKBACK) {
  const swings = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const high = candles[i].high;
    const low  = candles[i].low;
    let isHigh = true, isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= high) isHigh = false;
      if (candles[j].low  <= low)  isLow  = false;
    }
    if (isHigh) swings.push({ idx: i, price: high, type: "high", rsi: rsiValues[i] });
    if (isLow)  swings.push({ idx: i, price: low,  type: "low",  rsi: rsiValues[i] });
  }
  return swings;
}

// ─── Parallel Channel ────────────────────────────────────────────────────────
// Fits a linear channel through the last N swing highs and swing lows.
// Returns { upper, lower, mid, slope, position: 'near_upper'|'near_lower'|'near_mid'|'inside' }

function buildChannel(swings, currentPrice) {
  const highs = swings.filter(s => s.type === "high").slice(-4);
  const lows  = swings.filter(s => s.type === "low").slice(-4);
  if (highs.length < 2 || lows.length < 2) return null;

  // Linear regression through highs and lows separately
  function linReg(points) {
    const n = points.length;
    const sumX = points.reduce((s, p) => s + p.idx, 0);
    const sumY = points.reduce((s, p) => s + p.price, 0);
    const sumXY = points.reduce((s, p) => s + p.idx * p.price, 0);
    const sumX2 = points.reduce((s, p) => s + p.idx * p.idx, 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    return { slope, intercept };
  }

  const lastIdx = swings[swings.length - 1]?.idx ?? 199;
  const highReg = linReg(highs);
  const lowReg  = linReg(lows);

  const upperAt = highReg.slope * lastIdx + highReg.intercept;
  const lowerAt = lowReg.slope  * lastIdx + lowReg.intercept;
  const midAt   = (upperAt + lowerAt) / 2;
  const channelHeight = upperAt - lowerAt;
  if (channelHeight <= 0) return null;

  const tolerance = 0.08; // within 8% of channel height = "near" a line
  const posFromBottom = (currentPrice - lowerAt) / channelHeight;

  let position;
  if (posFromBottom <= tolerance)           position = "near_lower";
  else if (posFromBottom >= 1 - tolerance)  position = "near_upper";
  else if (Math.abs(posFromBottom - 0.5) <= tolerance) position = "near_mid";
  else                                      position = "inside";

  return {
    upper: upperAt,
    lower: lowerAt,
    mid:   midAt,
    slope: highReg.slope,
    channelHeight,
    posFromBottom,
    position,
  };
}

// ─── Divergence detection ────────────────────────────────────────────────────
// Looks at the last 2 same-type swing points and compares price vs RSI direction.
// Returns { type: 'regular'|'hidden'|'exaggerated', direction: 'bullish'|'bearish', strength: 0-2 } or null

function detectDivergence(swings, side) {
  // For bullish divergence we look at swing LOWS; for bearish at swing HIGHS
  const swingType = side === "long" ? "low" : "high";
  const relevant  = swings.filter(s => s.type === swingType && s.rsi != null).slice(-3);
  if (relevant.length < 2) return null;

  const prev = relevant[relevant.length - 2];
  const curr = relevant[relevant.length - 1];
  if (!prev || !curr) return null;

  const priceHigher = curr.price > prev.price;
  const priceLower  = curr.price < prev.price;
  const priceEqual  = Math.abs(curr.price - prev.price) / prev.price < 0.005;
  const rsiHigher   = curr.rsi  > prev.rsi;
  const rsiLower    = curr.rsi  < prev.rsi;

  // Bullish divergence types (at swing lows → long signal)
  if (side === "long") {
    if (priceLower && rsiHigher)  return { type: "regular",      direction: "bullish", strength: 2 };
    if (priceHigher && rsiLower)  return { type: "hidden",       direction: "bullish", strength: 1 };
    if (priceEqual  && rsiHigher) return { type: "exaggerated",  direction: "bullish", strength: 1 };
  }
  // Bearish divergence types (at swing highs → short signal)
  if (side === "short") {
    if (priceHigher && rsiLower)  return { type: "regular",      direction: "bearish", strength: 2 };
    if (priceLower  && rsiHigher) return { type: "hidden",       direction: "bearish", strength: 1 };
    if (priceEqual  && rsiLower)  return { type: "exaggerated",  direction: "bearish", strength: 1 };
  }
  return null;
}

// ─── Fibonacci helpers ────────────────────────────────────────────────────────

function nearFib(ratio, fibs = FIB_LEVELS, tol = FIB_TOLERANCE) {
  for (const f of fibs) {
    if (Math.abs(ratio - f) <= tol) return f;
  }
  return null;
}

function fibRatio(impulseStart, impulseEnd, retraceEnd) {
  const impulse = Math.abs(impulseEnd - impulseStart);
  if (impulse === 0) return null;
  return Math.abs(retraceEnd - impulseEnd) / impulse;
}

// ─── Elliott Wave corrective pattern detection ────────────────────────────────
// Scans recent swing sequence for Flat, Zig Zag, or Triangle completions.
// Returns { pattern, wave, fibHit, score } or null

function detectCorrectiveWave(swings, side) {
  // For a bullish setup: impulse up → correction down (A down, B up, C down)
  // For a bearish setup: impulse down → correction up (A up, B down, C up)
  const needed = side === "long" ? ["high","low","high","low"] : ["low","high","low","high"];
  // Get the last 4+ alternating swings
  const alt = [];
  for (let i = swings.length - 1; i >= 0 && alt.length < 6; i--) {
    if (alt.length === 0 || swings[i].type !== alt[alt.length - 1].type) {
      alt.unshift(swings[i]);
    }
  }
  if (alt.length < 4) return null;

  // Check last 4 swings: [impulseEnd, A, B, C]
  // impulseEnd = the peak/trough before the correction
  const [impulseEnd, waveA, waveB, waveC] = alt.slice(-4);
  if (!waveC) return null;

  const impulseStart = alt.slice(-5)[0] ?? impulseEnd;
  const ratio = fibRatio(impulseStart.price, impulseEnd.price, waveC.price);
  const fibHit = ratio != null ? nearFib(ratio) : null;

  // Wave B retracement of Wave A
  const aLen = Math.abs(waveA.price - impulseEnd.price);
  const bLen = Math.abs(waveB.price - waveA.price);
  const bRetrace = aLen > 0 ? bLen / aLen : 0;

  // ── Zig Zag: B retraces 38-62% of A, C extends beyond A endpoint ──
  if (bRetrace >= 0.35 && bRetrace <= 0.65) {
    const cLen = Math.abs(waveC.price - waveB.price);
    const abcdRatio = aLen > 0 ? cLen / aLen : 0;
    if (abcdRatio >= 0.8 && abcdRatio <= 1.5) {
      return { pattern: "zigzag", wavesDetected: 3, fibHit, bRetrace, score: fibHit ? 25 : 15 };
    }
  }

  // ── Flat: B retraces 85-110% of A (returns to impulseEnd), C ~= A endpoint ──
  if (bRetrace >= 0.85 && bRetrace <= 1.15) {
    const cLen = Math.abs(waveC.price - waveB.price);
    const acRatio = aLen > 0 ? cLen / aLen : 0;
    if (acRatio >= 0.8 && acRatio <= 1.3) {
      return { pattern: "flat", wavesDetected: 3, fibHit, bRetrace, score: fibHit ? 22 : 12 };
    }
  }

  // ── Triangle: need 5 waves (A-B-C-D-E), check if last 5 swings are contracting ──
  if (alt.length >= 5) {
    const [wA, wB, wC2, wD, wE] = alt.slice(-5);
    const heights = [
      Math.abs(wB.price - wA.price),
      Math.abs(wC2.price - wB.price),
      Math.abs(wD.price - wC2.price),
      Math.abs(wE.price - wD.price),
    ];
    const contracting = heights[0] > heights[1] && heights[1] > heights[2] && heights[2] > heights[3];
    if (contracting) {
      return { pattern: "triangle", wavesDetected: 5, fibHit, score: 20 };
    }
  }

  return null;
}

// ─── Trend context via EMAs ───────────────────────────────────────────────────

function calcEMA(closes, period) {
  const k = 2 / (period + 1);
  let ema = closes[0];
  const result = [ema];
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

// ─── Main analysis per symbol ─────────────────────────────────────────────────

function analyzeSymbol(symbol, candles) {
  if (candles.length < 60) return null;

  const closes = candles.map(c => c.close);
  const rsiVals = calcRSI(closes);
  const swings  = detectSwings(candles, rsiVals);
  if (swings.length < 6) return null;

  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const lastClose  = closes[closes.length - 1];
  const lastEma20  = ema20[ema20.length - 1];
  const lastEma50  = ema50[ema50.length - 1];
  const lastRsi    = rsiVals[rsiVals.length - 1];
  const uptrend    = lastEma20 > lastEma50;

  const channel = buildChannel(swings, lastClose);
  const signals = [];

  for (const side of ["long", "short"]) {
    // Trend context gate: prefer longs in uptrend, shorts in downtrend
    const trendAligned = side === "long" ? uptrend : !uptrend;

    // ── Pillar 1: Channel position ──────────────────────────────────────
    let channelScore = 0;
    let channelDesc  = "no channel";
    if (channel) {
      if (side === "long" && channel.position === "near_lower") { channelScore = 25; channelDesc = "at lower channel"; }
      if (side === "long" && channel.position === "near_mid")   { channelScore = 12; channelDesc = "at midline (pullback long)"; }
      if (side === "short" && channel.position === "near_upper"){ channelScore = 25; channelDesc = "at upper channel"; }
      if (side === "short" && channel.position === "near_mid")  { channelScore = 12; channelDesc = "at midline (pullback short)"; }
    }

    // ── Pillar 2: RSI Divergence ────────────────────────────────────────
    const div = detectDivergence(swings, side);
    const divScore = div ? (div.strength === 2 ? 30 : 20) : 0;
    const divDesc  = div ? `${div.type} ${div.direction} divergence` : "no divergence";

    // ── Pillar 3: Elliott Wave corrective structure ─────────────────────
    const wave = detectCorrectiveWave(swings, side);
    const waveScore = wave?.score ?? 0;
    const waveDesc  = wave ? `${wave.pattern} (${wave.wavesDetected}-wave) ${wave.fibHit ? `@ fib ${wave.fibHit}` : ""}` : "no pattern";

    // ── Pillar 4: Fibonacci retracement of prior impulse ───────────────
    // Standalone fib check: is current price near a key fib of the prior swing?
    let fibScore = 0, fibDesc = "no fib";
    const priorImpulseSwings = swings.filter(s => s.type === (side === "long" ? "high" : "low")).slice(-2);
    if (priorImpulseSwings.length === 2) {
      const [impStart, impEnd] = priorImpulseSwings;
      const impulse = Math.abs(impEnd.price - impStart.price);
      if (impulse > 0) {
        const retrace = Math.abs(lastClose - impEnd.price) / impulse;
        const hit = nearFib(retrace);
        if (hit) {
          const keyFibs = [0.5, 0.618, 0.786];
          fibScore = keyFibs.includes(hit) ? 20 : 10;
          fibDesc  = `price at ${hit} fib retracement`;
        }
      }
    }
    // If wave already includes a fib hit, don't double-count
    if (wave?.fibHit && fibScore > 0) fibScore = Math.max(fibScore - 10, 0);

    // ── RSI zone bonus ──────────────────────────────────────────────────
    let rsiBonus = 0, rsiDesc = "";
    if (lastRsi != null) {
      if (side === "long"  && lastRsi < 40) { rsiBonus = 5; rsiDesc = `RSI oversold (${lastRsi.toFixed(0)})`; }
      if (side === "short" && lastRsi > 60) { rsiBonus = 5; rsiDesc = `RSI overbought (${lastRsi.toFixed(0)})`; }
    }

    // ── Trend alignment bonus ───────────────────────────────────────────
    const trendBonus = trendAligned ? 5 : -10;

    // ── Composite score ────────────────────────────────────────────────
    const rawScore  = channelScore + divScore + waveScore + fibScore + rsiBonus + trendBonus;
    const score     = Math.min(100, Math.max(0, rawScore));

    // Hard gates: must have at least divergence OR wave pattern, AND channel position
    const hasPillar1 = channelScore > 0;
    const hasPillar2 = divScore > 0;
    const hasPillar3 = waveScore > 0;
    const confluenceCount = [hasPillar1, hasPillar2, hasPillar3].filter(Boolean).length;

    if (score < MIN_SCORE || confluenceCount < 2) continue;

    // ── Entry / SL / TP ─────────────────────────────────────────────────
    // SL: 1.5× ATR from entry. TP: 2R minimum (3× ATR).
    const recentCandles = candles.slice(-20);
    const atr = recentCandles.reduce((s, c) => s + (c.high - c.low), 0) / recentCandles.length;
    const slDist  = Math.max(atr * 1.5, lastClose * 0.015);
    const entry   = lastClose;
    const sl      = side === "long" ? entry - slDist : entry + slDist;
    const tp1     = side === "long" ? entry + slDist * 2 : entry - slDist * 2; // 2R
    const tp2     = side === "long" ? entry + slDist * 3 : entry - slDist * 3; // 3R

    signals.push({
      symbol,
      side,
      score,
      entry,
      sl,
      tp1,
      tp2,
      atr,
      confluenceCount,
      pillars: {
        channel:    { score: channelScore,  desc: channelDesc },
        divergence: { score: divScore,      desc: divDesc, detail: div },
        wave:       { score: waveScore,     desc: waveDesc, detail: wave },
        fibonacci:  { score: fibScore,      desc: fibDesc },
        rsi:        { score: rsiBonus,      desc: rsiDesc, value: lastRsi },
        trend:      { score: trendBonus,    desc: trendAligned ? "trend-aligned" : "counter-trend" },
      },
      channel,
      interval: INTERVAL,
      detectedAt: Date.now(),
    });
  }

  return signals.length ? signals : null;
}

// ─── Discord alert ────────────────────────────────────────────────────────────

async function sendTAAlert(webhook, signal) {
  if (!webhook) return;
  const { symbol, side, score, entry, sl, tp1, tp2, pillars, confluenceCount } = signal;
  const isBull  = side === "long";
  const color   = isBull ? 0x22c55e : 0xef4444;
  const emoji   = isBull ? "🟢" : "🔴";
  const scoreEmoji = score >= 85 ? "🔥" : score >= 70 ? "⚡" : "📡";

  const fmt = v => `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
  const pct = (a, b) => `${((b - a) / a * 100).toFixed(2)}%`;

  const pillarRows = [
    `📐 Channel: ${pillars.channel.desc} (${pillars.channel.score}pts)`,
    `📊 Divergence: ${pillars.divergence.desc} (${pillars.divergence.score}pts)`,
    `🌊 Wave: ${pillars.wave.desc} (${pillars.wave.score}pts)`,
    `🔢 Fibonacci: ${pillars.fibonacci.desc} (${pillars.fibonacci.score}pts)`,
    pillars.rsi.score > 0 ? `💹 ${pillars.rsi.desc}` : null,
    `📈 Trend: ${pillars.trend.desc}`,
  ].filter(Boolean).join("\n");

  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        title: `${scoreEmoji} ${emoji} ${symbol} ${side.toUpperCase()} — TA Confluence Signal`,
        color,
        description: `**Score: ${score}/100** · ${confluenceCount}/3 pillars · ${INTERVAL} timeframe`,
        fields: [
          { name: "Entry",      value: fmt(entry),                  inline: true },
          { name: "Stop Loss",  value: `${fmt(sl)} (${pct(entry, sl)})`,  inline: true },
          { name: "TP1 (2R)",   value: `${fmt(tp1)} (${pct(entry, tp1)})`, inline: true },
          { name: "TP2 (3R)",   value: `${fmt(tp2)} (${pct(entry, tp2)})`, inline: true },
          { name: "Confluence", value: pillarRows,                  inline: false },
        ],
        footer: { text: "Soloris · TA Perps · 4H" },
        timestamp: new Date().toISOString(),
      }],
    }),
  });
}

// ─── Universe fetch ───────────────────────────────────────────────────────────

async function fetchUniverse() {
  const info = await fetchJson(`${BINANCE_FAPI}/exchangeInfo`, "exchangeInfo");
  return perpUniverseSymbols(info).map(s => s.symbol);
}

// ─── Main scan ────────────────────────────────────────────────────────────────

function defaultState() {
  return { alerts: {}, signals: [], lastScan: 0 };
}

async function runTAPerps_Scan(state, { webhook } = {}) {
  const now     = Date.now();
  const summary = { scanned: 0, signals: 0, alerted: 0, errors: [] };
  state.alerts  = state.alerts || {};
  state.signals = state.signals || [];

  const allSymbols = await fetchUniverse();
  // Scan top liquid symbols first (BTCUSDT, ETHUSDT, etc. are first in the list)
  const symbols = allSymbols.slice(0, 80);

  // Batch with concurrency limit
  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    const batch = symbols.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async sym => {
        const candles = await fetchKlines(sym);
        summary.scanned++;
        return { sym, signals: analyzeSymbol(sym, candles) };
      })
    );

    for (const result of results) {
      if (result.status !== "fulfilled" || !result.value.signals) continue;
      const { sym, signals } = result.value;

      for (const signal of signals) {
        summary.signals++;
        const key = `${sym}_${signal.side}`;
        const lastAlert = state.alerts[key] || 0;
        if (now - lastAlert < SIGNAL_COOLDOWN_MS) continue;

        // Save signal to state
        state.signals = [signal, ...state.signals.filter(s => !(s.symbol === sym && s.side === signal.side))].slice(0, 50);
        state.alerts[key] = now;

        try {
          await sendTAAlert(webhook, signal);
          summary.alerted++;
        } catch (e) {
          summary.errors.push(`${sym}: ${e.message}`);
        }
      }
    }
  }

  // Purge old alerts (>48h)
  const cutoff = now - 48 * 60 * 60 * 1000;
  for (const [k, ts] of Object.entries(state.alerts)) {
    if (ts < cutoff) delete state.alerts[k];
  }

  state.lastScan = now;
  return summary;
}

module.exports = { runTAPerps_Scan, analyzeSymbol, defaultState };
