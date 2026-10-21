"use strict";
/**
 * breakout-scanner.js — "Accumulation Breakout" strategy
 *
 * Detects the 6-phase pattern:
 *   1. Prior downtrend / slow decline
 *   2. Capitulation spike (sharp acceleration down)
 *   3. V-shaped recovery (sharp bounce)
 *   4. Low retest (price returns near the cap low, holds)
 *   5. Accumulation structure (tight range, higher lows building)
 *   6. Breakout with volume expansion → entry signal
 *
 * Timeframe: 1D (daily candles, same as the reference charts).
 * Scans top 150 Binance USDT perpetuals.
 */

const { fetchJson, mapKlineEntry, perpUniverseSymbols } = require("./engine-core");

const BINANCE_FAPI      = "https://fapi.binance.com/fapi/v1";
const INTERVAL          = "1d";
const KLINE_LIMIT       = 120;   // ~4 months of daily candles
const CONCURRENCY       = 6;
const MIN_SCORE         = 55;
const SIGNAL_COOLDOWN_MS = 24 * 60 * 60 * 1000;  // 1 signal per symbol per day

// Paper trading
const PAPER_START       = 100;
const PAPER_LEVERAGE    = 3;     // lower leverage for daily-TF swing trades
const PAPER_MAX_POS     = 5;
const PAPER_EXPIRY      = 14 * 24 * 60 * 60 * 1000;  // 14 days (daily swings take longer)
const PAPER_BE_TRIGGER  = 15;    // trail SL to BE at +15% leveraged gain
const CB_MAX_DD_PCT     = 30;
const CB_MAX_LOSSES     = 4;
const CB_DD_PAUSE_MS    = 24 * 60 * 60 * 1000;
const CB_STREAK_PAUSE_MS = 6 * 60 * 60 * 1000;

// ─── Klines ───────────────────────────────────────────────────────────────────

async function fetchKlines(symbol) {
  const url = `${BINANCE_FAPI}/klines?symbol=${symbol}&interval=${INTERVAL}&limit=${KLINE_LIMIT}`;
  const raw = await fetchJson(url, `bo-klines:${symbol}`);
  return raw.map(mapKlineEntry);
}

// ─── ATR ─────────────────────────────────────────────────────────────────────

function calcATR(candles, period = 14) {
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const c    = candles[i];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)));
  }
  if (trs.length < period) return trs.reduce((s, v) => s + v, 0) / trs.length;
  return trs.slice(-period).reduce((s, v) => s + v, 0) / period;
}

// ─── Core pattern detection ───────────────────────────────────────────────────

function detectPattern(candles) {
  if (candles.length < 40) return null;

  // Work on last 90 candles max
  const window = candles.slice(-90);
  const n      = window.length;

  // ── Phase 1+2: Find the capitulation low ─────────────────────────────────
  // It must have had a meaningful downtrend before it.
  // Search between bar 15 and (n-8) so there's room for recovery + structure.
  let capIdx = -1, capLow = Infinity;
  for (let i = 15; i < n - 8; i++) {
    if (window[i].low < capLow) { capLow = window[i].low; capIdx = i; }
  }
  if (capIdx === -1) return null;

  // Confirm downtrend: price 15-30 bars before cap must be ≥25% above cap low
  const lookback = Math.max(0, capIdx - 25);
  const preHigh  = Math.max(...window.slice(lookback, capIdx).map(c => c.close));
  const declinePct = (preHigh - capLow) / preHigh * 100;
  if (declinePct < 25) return null;

  // ── Phase 3: V-recovery ───────────────────────────────────────────────────
  // Within 12 bars of capIdx, price must close back above 50% of the drop.
  const recoveryTarget = capLow + (preHigh - capLow) * 0.45;
  let recoveryIdx = -1, recoveryHigh = capLow;
  for (let i = capIdx + 1; i <= Math.min(capIdx + 12, n - 1); i++) {
    if (window[i].close > recoveryHigh) recoveryHigh = window[i].close;
    if (window[i].close >= recoveryTarget && recoveryIdx === -1) recoveryIdx = i;
  }
  if (recoveryIdx === -1) return null;

  // ── Phase 4: Low retest ───────────────────────────────────────────────────
  // After the V-recovery, price pulls back to within 22% of cap low and holds.
  const retestThresh = capLow * 1.22;
  let retestIdx = -1, retestLow = Infinity;
  for (let i = recoveryIdx + 1; i < n - 4; i++) {
    if (window[i].low <= retestThresh) {
      if (window[i].low < retestLow) { retestLow = window[i].low; retestIdx = i; }
    }
  }
  if (retestIdx === -1) return null;

  // Retest must not undercut the capitulation low by more than 8%
  if (retestLow < capLow * 0.92) return null;

  // ── Phase 5: Accumulation structure ──────────────────────────────────────
  // From retest onward: price forms higher lows in a tight range.
  const accStart   = retestIdx + 1;
  const accCandles = window.slice(accStart);
  if (accCandles.length < 3) return null;

  const accHighs = accCandles.map(c => c.high);
  const accLows  = accCandles.map(c => c.low);
  const structureHigh = Math.max(...accHighs);
  const structureLow  = Math.min(...accLows);
  const structureRange = (structureHigh - structureLow) / structureLow * 100;

  // Check for at least 2 rising lows within the accumulation block
  const swingLows = [];
  for (let i = 1; i < accCandles.length - 1; i++) {
    if (accCandles[i].low < accCandles[i - 1].low && accCandles[i].low < accCandles[i + 1].low) {
      swingLows.push(accCandles[i].low);
    }
  }
  const hasRisingLows = swingLows.length >= 2 &&
    swingLows[swingLows.length - 1] > swingLows[0];

  // Tight accumulation: range < 35% of price
  const isTight = structureRange < 35;

  // ── Phase 6: Breakout ─────────────────────────────────────────────────────
  const lastCandle = window[n - 1];
  const prevCandle = window[n - 2];
  const currentClose = lastCandle.close;

  // Breakout: current close is above or very near the structure high
  const breakoutConfirmed = currentClose >= structureHigh * 0.97;
  if (!breakoutConfirmed) return null;

  // Volume expansion on breakout candle
  const accAvgVol = accCandles.length > 1
    ? accCandles.slice(0, -1).reduce((s, c) => s + c.volume, 0) / (accCandles.length - 1)
    : lastCandle.volume;
  const volExpansion = accAvgVol > 0 ? lastCandle.volume / accAvgVol : 1;
  const hasVolume   = volExpansion >= 1.25;

  // ── Scoring ───────────────────────────────────────────────────────────────
  let score = 0;

  // Decline magnitude
  if      (declinePct >= 70) score += 30;
  else if (declinePct >= 50) score += 22;
  else if (declinePct >= 35) score += 15;
  else                       score += 8;

  // Retest accuracy (tighter = more reliable double-bottom)
  const retestAccuracy = (retestLow - capLow) / capLow * 100;
  if      (retestAccuracy <= 5)  score += 25;
  else if (retestAccuracy <= 12) score += 18;
  else                           score += 10;

  // Accumulation structure quality
  if (isTight)       score += 15;
  if (hasRisingLows) score += 15;

  // Volume expansion
  if      (volExpansion >= 2.5) score += 20;
  else if (volExpansion >= 1.5) score += 12;
  else if (hasVolume)           score += 6;

  // Breakout confirmation (close vs structure high)
  const breakoutStrength = (currentClose - structureHigh) / structureHigh * 100;
  if      (breakoutStrength >= 3) score += 10;
  else if (breakoutStrength >= 0) score += 6;
  else                            score += 3; // near breakout

  score = Math.min(100, score);

  if (score < MIN_SCORE) return null;

  // ── Entry / SL / TP ───────────────────────────────────────────────────────
  const atr    = calcATR(window);
  const entry  = currentClose;
  const sl     = Math.max(structureLow, retestLow) - atr * 0.5;  // below structure + buffer
  const slDist = entry - sl;
  const tp1    = entry + slDist * 2;   // 2R
  const tp2    = entry + slDist * 3.5; // 3.5R — daily swings have larger targets

  return {
    score,
    declinePct:      Math.round(declinePct * 10) / 10,
    capLow,
    retestLow,
    retestAccuracy:  Math.round(retestAccuracy * 10) / 10,
    structureHigh,
    structureRange:  Math.round(structureRange * 10) / 10,
    volExpansion:    Math.round(volExpansion * 100) / 100,
    hasRisingLows,
    isTight,
    accumulationBars: accCandles.length,
    entry,
    sl,
    tp1,
    tp2,
    atr,
    interval:       INTERVAL,
    detectedAt:     Date.now(),
    phases: {
      decline:      { pct: Math.round(declinePct), preHigh, capLow },
      recovery:     { recoveryIdx: recoveryIdx - capIdx, recoveryHigh },
      retest:       { retestAccuracy: Math.round(retestAccuracy * 10) / 10, retestLow },
      accumulation: { bars: accCandles.length, tight: isTight, risingLows: hasRisingLows },
      breakout:     { structureHigh, volExpansion: Math.round(volExpansion * 100) / 100 },
    },
  };
}

// ─── Discord alert ────────────────────────────────────────────────────────────

async function sendBreakoutAlert(webhook, symbol, signal) {
  if (!webhook) return;
  const { score, entry, sl, tp1, tp2, phases, declinePct, volExpansion, accumulationBars } = signal;
  const color     = 0xf59e0b;  // amber — breakout
  const scoreEmoji = score >= 80 ? "🔥" : score >= 65 ? "⚡" : "📡";
  const fmt = v => `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 })}`;
  const pct = (a, b) => `${((b - a) / a * 100).toFixed(1)}%`;

  const detail = [
    `📉 Prior decline: **${declinePct}%** from recent high`,
    `🔄 Low retest accuracy: **${phases.retest.retestAccuracy}%** above cap low`,
    `📦 Accumulation: **${accumulationBars} bars** · ${signal.isTight ? "tight range ✓" : "wide range"} · ${signal.hasRisingLows ? "rising lows ✓" : "no rising lows"}`,
    `📊 Volume expansion: **${volExpansion}×** vs accumulation avg`,
    `🎯 Structure high broken: **${fmt(phases.breakout.structureHigh)}**`,
  ].join("\n");

  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        title: `${scoreEmoji} 🟡 ${symbol.replace("USDT", "/USDT")} — Accumulation Breakout`,
        color,
        description: `**Score: ${score}/100** · ${INTERVAL} timeframe · ${PAPER_LEVERAGE}× leverage`,
        fields: [
          { name: "Entry",       value: fmt(entry),                           inline: true },
          { name: "Stop Loss",   value: `${fmt(sl)} (${pct(entry, sl)})`,     inline: true },
          { name: "TP1 (2R)",    value: `${fmt(tp1)} (${pct(entry, tp1)})`,   inline: true },
          { name: "TP2 (3.5R)",  value: `${fmt(tp2)} (${pct(entry, tp2)})`,   inline: true },
          { name: "Pattern",     value: detail,                               inline: false },
        ],
        footer: { text: "Soloris · Breakout · Daily" },
        timestamp: new Date().toISOString(),
      }],
    }),
  });
}

// ─── Paper trading ────────────────────────────────────────────────────────────

function defaultPaper() {
  return {
    balance: PAPER_START, startingBalance: PAPER_START,
    openPositions: [], closedTrades: [], lastMarkAt: 0,
    peakBalance: PAPER_START, consecutiveLosses: 0,
    pausedUntil: 0, pauseReason: null, symbolCooldowns: {},
  };
}

function closePaperPos(paper, pos, closePrice, reason, now) {
  if (paper.closedTrades.some(t => t.id === pos.id)) return null;
  const diff   = closePrice - pos.entryPrice; // always long
  const lev    = pos.leverage || PAPER_LEVERAGE;
  const legPnl = Math.round((diff / pos.entryPrice) * pos.size * lev * 100) / 100;
  const total  = Math.round(((pos.realizedPnl || 0) + legPnl) * 100) / 100;
  const pnlPct = Math.round((diff / pos.entryPrice) * lev * 10000) / 100;
  paper.balance = Math.max(0, Math.round((paper.balance + legPnl) * 100) / 100);
  const closed  = { ...pos, closedAt: now, closedPrice: closePrice, closeReason: reason, pnl: total, pnlPct };
  paper.closedTrades.unshift(closed);
  paper.closedTrades = paper.closedTrades.slice(0, 200);
  if ((reason === "SL" || reason === "BE") && total < 0) {
    paper.symbolCooldowns = paper.symbolCooldowns || {};
    paper.symbolCooldowns[pos.symbol] = now + 48 * 60 * 60 * 1000; // 48h cooldown on daily
  }
  // Circuit breaker
  paper.peakBalance = Math.max(paper.peakBalance || PAPER_START, paper.balance);
  if (total < 0) paper.consecutiveLosses = (paper.consecutiveLosses || 0) + 1;
  else if (total > 0) paper.consecutiveLosses = 0;
  if (now >= (paper.pausedUntil || 0)) {
    const dd = paper.peakBalance > 0 ? ((paper.peakBalance - paper.balance) / paper.peakBalance) * 100 : 0;
    if (dd >= CB_MAX_DD_PCT) { paper.pausedUntil = now + CB_DD_PAUSE_MS; paper.pauseReason = `Drawdown ${dd.toFixed(1)}% — paused 24h`; }
    else if ((paper.consecutiveLosses || 0) >= CB_MAX_LOSSES) { paper.pausedUntil = now + CB_STREAK_PAUSE_MS; paper.pauseReason = `${paper.consecutiveLosses} consecutive losses — paused 6h`; }
  }
  return closed;
}

function openPaperTrade(paper, symbol, signal, now) {
  if (now < (paper.pausedUntil || 0)) return;
  if (paper.openPositions.length >= PAPER_MAX_POS) return;
  if (paper.openPositions.some(p => p.symbol === symbol)) return;
  if (paper.balance < 1) return;
  const cool = (paper.symbolCooldowns || {})[symbol] || 0;
  if (now < cool) return;
  const t    = Math.min(1, Math.max(0, (signal.score - MIN_SCORE) / (100 - MIN_SCORE)));
  const pct  = 0.08 + t * 0.06;
  const size = Math.max(0.50, Math.round(paper.balance * pct * 100) / 100);
  paper.openPositions.push({
    id:          `bo-${symbol}-${now}`,
    symbol,
    side:        "long",  // breakout is always long
    score:       signal.score,
    entryPrice:  signal.entry,
    sl:          signal.sl,
    tp1:         signal.tp1,
    tp2:         signal.tp2,
    size,
    originalSize: size,
    leverage:    PAPER_LEVERAGE,
    openedAt:    now,
    realizedPnl: 0,
    tp1Reached:  false,
    slMovedToBE: false,
    lastMarkPrice: null,
    lastMarkAt:  0,
    phases:      signal.phases,
    declinePct:  signal.declinePct,
    volExpansion: signal.volExpansion,
  });
}

async function sendPaperCloseAlert(webhook, pos, reason) {
  if (!webhook) return;
  const isWin   = (pos.pnl ?? 0) >= 0;
  const color   = isWin ? 0x22c55e : 0xef4444;
  const icon    = { TP2:"🏆", TP1:"✅", BE:"🔒", SL:"🛑", EXPIRED:"⌛" }[reason] ?? "📋";
  const fmt     = v => `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 })}`;
  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        title: `${icon} [Breakout Paper] ${pos.symbol.replace("USDT","/USDT")} LONG — ${reason}`,
        color,
        fields: [
          { name: "Entry",    value: fmt(pos.entryPrice),                                inline: true },
          { name: "Close",    value: fmt(pos.closedPrice),                               inline: true },
          { name: "P&L",      value: `${(pos.pnl??0)>=0?"+":""}$${(pos.pnl??0).toFixed(2)} (${(pos.pnlPct??0).toFixed(1)}%)`, inline: true },
          { name: "Score",    value: `${pos.score}/100`,                                 inline: true },
          { name: "Leverage", value: `${PAPER_LEVERAGE}×`,                               inline: true },
        ],
        footer: { text: "Soloris · Breakout Paper Trade" },
        timestamp: new Date().toISOString(),
      }],
    }),
  });
}

async function markBreakoutPaper(paper, now, webhook) {
  if (!paper.openPositions.length) return;
  const syms   = [...new Set(paper.openPositions.map(p => p.symbol))];
  const prices = {};
  await Promise.allSettled(syms.map(async sym => {
    try {
      const d = await fetchJson(`${BINANCE_FAPI}/ticker/price?symbol=${sym}`, `bo-price ${sym}`);
      if (d?.price) prices[sym] = parseFloat(d.price);
    } catch (_) {}
  }));
  paper.lastMarkAt = now;
  const stillOpen  = [];
  for (const pos of paper.openPositions) {
    const price = prices[pos.symbol];
    if (!price) {
      const since = now - (pos.lastMarkAt || pos.openedAt);
      if (since > PAPER_EXPIRY) closePaperPos(paper, pos, pos.lastMarkPrice || pos.entryPrice, "EXPIRED", now);
      else stillOpen.push(pos);
      continue;
    }
    const expiry = pos.tp1Reached ? PAPER_EXPIRY * 2 : PAPER_EXPIRY;
    if (now - pos.openedAt > expiry) {
      const closed = closePaperPos(paper, pos, price, "EXPIRED", now);
      if (closed) await sendPaperCloseAlert(webhook, closed, "EXPIRED");
      continue;
    }
    if (price <= pos.sl) {
      const isBE   = pos.tp1Reached || pos.slMovedToBE;
      const closed = closePaperPos(paper, pos, pos.sl, isBE ? "BE" : "SL", now);
      if (closed) await sendPaperCloseAlert(webhook, closed, isBE ? "BE" : "SL");
    } else if (price >= pos.tp2) {
      const closed = closePaperPos(paper, pos, pos.tp2, "TP2", now);
      if (closed) await sendPaperCloseAlert(webhook, closed, "TP2");
    } else if (price >= pos.tp1 && !pos.tp1Reached) {
      const diff       = pos.tp1 - pos.entryPrice;
      const partialSz  = Math.round(pos.size * 0.5 * 100) / 100;
      const partialPnl = Math.round((diff / pos.entryPrice) * partialSz * PAPER_LEVERAGE * 100) / 100;
      paper.balance    = Math.max(0, Math.round((paper.balance + partialPnl) * 100) / 100);
      pos.realizedPnl  = Math.round(((pos.realizedPnl || 0) + partialPnl) * 100) / 100;
      pos.size         = Math.round((pos.size - partialSz) * 100) / 100;
      pos.tp1Reached   = true; pos.sl = pos.entryPrice; pos.slMovedToBE = true;
      pos.lastMarkPrice = price; pos.lastMarkAt = now;
      const tp1PnlPct  = Math.round((diff / pos.entryPrice) * PAPER_LEVERAGE * 10000) / 100;
      await sendPaperCloseAlert(webhook, { ...pos, pnl: partialPnl, pnlPct: tp1PnlPct, closedPrice: pos.tp1 }, "TP1");
      stillOpen.push(pos);
    } else {
      if (!pos.slMovedToBE && pos.entryPrice > 0) {
        const fav = price - pos.entryPrice;
        if ((fav / pos.entryPrice) * PAPER_LEVERAGE * 100 >= PAPER_BE_TRIGGER) {
          pos.sl = pos.entryPrice; pos.slMovedToBE = true;
        }
      }
      pos.lastMarkPrice = price; pos.lastMarkAt = now;
      stillOpen.push(pos);
    }
  }
  paper.openPositions = stillOpen;
}

// ─── Main scan ────────────────────────────────────────────────────────────────

function defaultState() {
  return { settings: { discordWebhook: "" }, alerts: {}, signals: [], paper: defaultPaper(), lastScan: 0 };
}

async function runBreakout_Scan(state, { webhook } = {}) {
  const now     = Date.now();
  const summary = { scanned: 0, detected: 0, alerted: 0, errors: [] };
  state.alerts  = state.alerts  || {};
  state.signals = state.signals || [];
  if (!state.paper) state.paper = defaultPaper();

  const info    = await fetchJson(`${BINANCE_FAPI}/exchangeInfo`, "bo-exchangeInfo");
  const symbols = perpUniverseSymbols(info).map(s => s.symbol).slice(0, 150);

  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    const batch   = symbols.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(async sym => {
      const candles = await fetchKlines(sym);
      summary.scanned++;
      const signal = detectPattern(candles);
      return { sym, signal };
    }));

    for (const r of results) {
      if (r.status !== "fulfilled" || !r.value.signal) continue;
      const { sym, signal } = r.value;
      signal.symbol = sym;
      summary.detected++;

      const lastAlert = state.alerts[sym] || 0;
      if (now - lastAlert < SIGNAL_COOLDOWN_MS) continue;

      state.signals = [signal, ...state.signals.filter(s => s.symbol !== sym)].slice(0, 50);
      state.alerts[sym] = now;
      openPaperTrade(state.paper, sym, signal, now);

      try {
        await sendBreakoutAlert(webhook, sym, signal);
        summary.alerted++;
      } catch (e) {
        summary.errors.push(`${sym}: ${e.message}`);
      }
    }
  }

  // Purge stale alerts (>72h)
  const cutoff = now - 72 * 60 * 60 * 1000;
  for (const [k, ts] of Object.entries(state.alerts)) {
    if (ts < cutoff) delete state.alerts[k];
  }
  state.lastScan = now;
  return summary;
}

module.exports = { runBreakout_Scan, markBreakoutPaper, detectPattern, defaultState, defaultPaper, PAPER_LEVERAGE, PAPER_START };
