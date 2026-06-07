/**
 * backtest-runtime.js — historical replay & performance harness for the perps engines.
 *
 * Why this exists: paper trading tells you how a strategy performs *going forward*,
 * one slow trade at a time. A backtest lets us replay months of historical 1H/4H
 * candles through the exact same `detectSignal` + sizing + exit logic the live
 * engines use, and get a statistically meaningful read (sample size, win rate,
 * profit factor, expectancy, drawdown) in seconds rather than weeks.
 *
 * Design choice: rather than re-implementing detection/exit rules here (which
 * would inevitably drift out of sync with the live engines), this harness
 * imports and replays the *exact* exported functions — `detectSignal`,
 * `qualityWeightedSizePct`, `applyEntrySlippage/applyExitSlippage`, and the
 * relevant constants — from claudeperps-runtime.js / emaperps-runtime.js.
 * "What you backtest is what you trade."
 *
 * Simplifications vs. live trading (documented, not hidden):
 *  - No funding-rate carry cost is modeled (premium index history isn't
 *    reliably available from the klines endpoint) — `premium.lastFundingRate`
 *    is fed as 0, matching the live engines' "neutral funding" path.
 *  - 24h quote-volume gating uses the latest live ticker snapshot rather than
 *    a true historical value (Binance doesn't expose historical 24hr stats).
 *  - One simulated position per symbol+side at a time (mirrors ALERT_COOLDOWN
 *    intent without replicating the full multi-symbol portfolio scheduler).
 */

"use strict";

const { mapKlineEntry, average, sanitizeNumber } = require("./engine-core");

const ENGINES = {
  claudeperps: () => require("./claudeperps-runtime"),
  emaperps: () => require("./emaperps-runtime"),
};

const KLINE_LIMIT = 1000; // Binance max candles per request

// ─── Historical data fetch (paginated) ──────────────────────────────────────

async function fetchKlinesRange(baseFapi, symbol, interval, startMs, endMs) {
  const out = [];
  let cursor = startMs;
  // Guard against runaway pagination (e.g. bad symbol with sparse history).
  for (let page = 0; page < 50 && cursor < endMs; page += 1) {
    const url = `${baseFapi}/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&startTime=${cursor}&endTime=${endMs}&limit=${KLINE_LIMIT}`;
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`klines ${symbol} ${interval} failed (${response.status})`);
    const batch = await response.json();
    if (!Array.isArray(batch) || !batch.length) break;
    for (const entry of batch) out.push(mapKlineEntry(entry));
    const lastOpenTime = Number(batch[batch.length - 1][0]);
    if (!Number.isFinite(lastOpenTime) || lastOpenTime <= cursor) break;
    cursor = lastOpenTime + 1;
    if (batch.length < KLINE_LIMIT) break; // exhausted available history
  }
  // De-dupe by candle time (overlapping pages can repeat the boundary candle).
  const seen = new Set();
  return out.filter((c) => {
    if (seen.has(c.time)) return false;
    seen.add(c.time);
    return true;
  }).sort((a, b) => a.time - b.time);
}

async function fetchLatestTicker(baseFapi, symbol) {
  try {
    const response = await fetch(`${baseFapi}/ticker/24hr?symbol=${encodeURIComponent(symbol)}`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (_) {
    return null;
  }
}

// ─── Trade simulation (mirrors markPaperPositions exit logic) ───────────────
//
// Walks forward bar-by-bar from the candle *after* entry, applying the same
// TP1-partial / breakeven-trail / TP2 / SL / time-expiry rules the live paper
// engine uses (see lib/{claudeperps,emaperps}-runtime.js markPaperPositions).

function simulateTrade(signal, candles1h, entryIndex, runtime) {
  const { side, entryPrice, sl: slInit, tp1, tp2 } = signal;
  const isLong = side === "Long";
  const entryFill = runtime.applyEntrySlippage(entryPrice, side);

  let sl = slInit;
  let slMovedToBE = false;
  let tp1Hit = false;
  let remainingFrac = 1; // fraction of original size still open
  let realizedPnlPct = 0; // weighted PnL% contribution from legs already closed (vs. original size)
  const entryTime = candles1h[entryIndex].time;
  const expiryTime = entryTime + (runtime.PAPER_EXPIRY || 48 * 60 * 60 * 1000);
  const beTriggerMovePct = (runtime.PAPER_BE_TRIGGER_PCT || 25) / (runtime.PAPER_LEVERAGE || 5);

  for (let i = entryIndex + 1; i < candles1h.length; i += 1) {
    const candle = candles1h[i];
    if (candle.time >= expiryTime) {
      const fill = runtime.applyExitSlippage(candle.close, side);
      const legPct = legPnlPct(entryFill, fill, side);
      return finish("EXPIRED", fill, realizedPnlPct + legPct * remainingFrac, candle.time);
    }

    const hi = candle.high, lo = candle.low;

    // Check SL first (conservative — assume adverse touch within the bar resolves first)
    const slHit = isLong ? lo <= sl : hi >= sl;
    const tp2Hit = isLong ? hi >= tp2 : lo <= tp2;
    const tp1Touch = isLong ? hi >= tp1 : lo <= tp1;

    if (slHit) {
      // SL fills are modeled as market stop-outs (slippage applies); BE-trailed
      // stops fill at/near entry — small residual edge from the original risk.
      const fill = runtime.applyExitSlippage(sl, side);
      const legPct = legPnlPct(entryFill, fill, side);
      const reason = slMovedToBE ? "BE_STOP" : "SL";
      return finish(reason, fill, realizedPnlPct + legPct * remainingFrac, candle.time);
    }

    if (tp2Hit) {
      // Resting limit order — filled at level, no slippage haircut (matches live).
      const legPct = legPnlPct(entryFill, tp2, side);
      return finish("TP2", tp2, realizedPnlPct + legPct * remainingFrac, candle.time);
    }

    if (tp1Touch && !tp1Hit) {
      tp1Hit = true;
      const closeFrac = runtime.TP1_PARTIAL_CLOSE_PCT || 0.5;
      const legPct = legPnlPct(entryFill, tp1, side);
      realizedPnlPct += legPct * closeFrac;
      remainingFrac -= closeFrac;
      // Trail SL to breakeven (entry) once price has moved favorably enough —
      // mirrors the live PAPER_BE_TRIGGER_PCT logic, applied at TP1 (always
      // satisfied at 3x ATR vs. a ~25%/5x = 5% underlying move trigger).
      sl = entryFill;
      slMovedToBE = true;
      if (remainingFrac <= 0.0001) {
        return finish("TP1_FULL", tp1, realizedPnlPct, candle.time);
      }
      // continue scanning this same candle's remainder isn't modeled (1H granularity) — fall through to next bar
    }
  }

  // Ran out of history before resolving — close at last known price (mark-to-market).
  const last = candles1h[candles1h.length - 1];
  const fill = runtime.applyExitSlippage(last.close, side);
  const legPct = legPnlPct(entryFill, fill, side);
  return finish("DATA_END", fill, realizedPnlPct + legPct * remainingFrac, last.time);

  function finish(outcome, exitPrice, totalPnlPct, exitTime) {
    return {
      outcome,
      exitPrice,
      exitTime,
      pnlPct: totalPnlPct,
      tp1Hit,
      // candle.time (and thus entryTime/exitTime) is in *seconds* — see
      // mapKlineEntry: Math.floor(openTime_ms / 1000) — so the bar-count
      // divisor is 3600 (seconds/hour), not 3.6e6 (ms/hour). The previous
      // ms-based divisor made every trade held under ~41 days round down to
      // "1 bar" — cosmetic only; it never affected pnl/outcome computation,
      // just the displayed avgBarsHeld figure.
      barsHeld: Math.max(1, Math.round((exitTime - entryTime) / 3600)),
    };
  }
}

function legPnlPct(entryFill, exitFill, side) {
  const raw = side === "Long"
    ? (exitFill - entryFill) / entryFill
    : (entryFill - exitFill) / entryFill;
  return raw * 100;
}

// ─── Per-symbol replay ───────────────────────────────────────────────────────

const WARMUP_1H = 60; // detectSignal requires >= 60 1H candles of context
const HTF_RATIO = 4;  // 1H candles per 4H candle

async function replaySymbol(symbol, candles1h, candles4h, liveTicker, runtime, options) {
  const trades = [];
  const { stepHours, leverage, alertQualityFloor } = options;
  // Track per-side cooldown so we don't open a flood of overlapping correlated
  // trades on the same symbol — mirrors ALERT_COOLDOWN / one-paper-position intent.
  let openUntilIndex = { Long: -1, Short: -1 };
  // Fallback 24h-quote-volume estimate (used only if we can't derive one from
  // history) — keeps the volume-based quality bonus from silently zeroing out.
  const fallbackQuoteVolume = Number(liveTicker?.quoteVolume) || 0;

  for (let i = WARMUP_1H; i < candles1h.length; i += stepHours) {
    // Build the 4H slice visible "as of" this 1H candle's close time.
    const cutoff = candles1h[i].time;
    const slice4h = candles4h.filter((c) => c.time <= cutoff);
    const slice1h = candles1h.slice(0, i + 1);
    if (slice1h.length < WARMUP_1H) continue;

    // CRITICAL: detectSignal reads `ticker.lastPrice` as "current price" — it
    // must reflect the price *at this point in history*, not today's live
    // price (which would make every replay step price-identical to "now" and
    // produce nonsensical instant-resolving trades). Synthesize a historical
    // ticker snapshot: lastPrice = this candle's close, quoteVolume = a
    // trailing 24-bar (≈24h on the 1H feed) sum of close×volume as a stand-in
    // for 24h quote volume (Binance doesn't expose historical 24hr stats).
    const last24 = slice1h.slice(-24);
    const estQuoteVolume = last24.length >= 24
      ? last24.reduce((s, c) => s + c.close * c.volume, 0)
      : fallbackQuoteVolume;
    const histTicker = { lastPrice: candles1h[i].close, quoteVolume: estQuoteVolume };

    let signal;
    try {
      signal = runtime.detectSignal(
        // claudeperps' detectSignal reads `data.candles1h`; emaperps' reads
        // `data.candles` (both are the same 1H series — see fetchSymbolData
        // in each runtime). Provide both keys so one harness serves either
        // engine without branching on its internal field-naming choices.
        { symbol, candles: slice1h, candles1h: slice1h, candles4h: slice4h, ticker: histTicker, premium: { lastFundingRate: 0 } },
        2
      );
    } catch (_) {
      continue;
    }
    if (!signal || signal.quality < alertQualityFloor) continue;
    if (i <= openUntilIndex[signal.side]) continue; // still "in a trade" on this side

    const result = simulateTrade(signal, candles1h, i, runtime);
    const sizePct = runtime.qualityWeightedSizePct(signal.quality);
    // Account-level PnL contribution: leveraged underlying move × position size
    // as a fraction of balance. (Assumes flat balance per trade — i.e. no
    // compounding across the sample — for an apples-to-apples per-trade view;
    // the equity-curve summary below applies compounding separately.)
    const accountPnlPct = result.pnlPct * leverage * sizePct;

    trades.push({
      symbol,
      side: signal.side,
      quality: signal.quality,
      entryTime: candles1h[i].time,
      entryPrice: signal.entryPrice,
      sizePct,
      ...result,
      accountPnlPct,
    });

    // Find the candle index nearest the exit time to resume scanning after this trade closes.
    let exitIdx = i + 1;
    while (exitIdx < candles1h.length && candles1h[exitIdx].time < result.exitTime) exitIdx += 1;
    openUntilIndex[signal.side] = exitIdx;
  }

  return trades;
}

// ─── Aggregate statistics ────────────────────────────────────────────────────

function summarize(trades, startingBalance) {
  if (!trades.length) {
    return {
      totalTrades: 0, wins: 0, losses: 0, breakeven: 0, winRate: 0,
      profitFactor: 0, avgWinPct: 0, avgLossPct: 0, expectancyPct: 0,
      cumulativeReturnPct: 0, maxDrawdownPct: 0,
      idealizedFinalBalance: startingBalance, idealizedReturnPct: 0,
      tp1HitRate: 0, avgBarsHeld: 0, byOutcome: {},
    };
  }

  const wins = trades.filter((t) => t.accountPnlPct > 0.01);
  const losses = trades.filter((t) => t.accountPnlPct < -0.01);
  const breakeven = trades.length - wins.length - losses.length;

  const grossWin = wins.reduce((s, t) => s + t.accountPnlPct, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.accountPnlPct, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);

  const avgWinPct = wins.length ? average(wins.map((t) => t.accountPnlPct)) : 0;
  const avgLossPct = losses.length ? average(losses.map((t) => t.accountPnlPct)) : 0;
  const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;
  const expectancyPct = average(trades.map((t) => t.accountPnlPct));

  const chrono = [...trades].sort((a, b) => a.entryTime - b.entryTime);

  // ── Headline figure: flat (non-compounding) cumulative return ──
  // Sums each trade's account-fraction PnL against the *original* starting
  // balance. This is the conservative, sample-size-comparable number — it's
  // what you'd realize if profits were withdrawn rather than reinvested, and
  // critically it doesn't overstate results from overlapping positions (the
  // live engine runs up to PAPER_MAX_POS concurrent trades sharing one pool of
  // capital — naive sequential compounding double/triple-counts that capital).
  // Drawdown is also measured on this curve for the same reason.
  let flatCum = 0;
  let flatPeak = 0;
  let maxDrawdownPct = 0;
  for (const t of chrono) {
    flatCum += t.accountPnlPct;
    if (flatCum > flatPeak) flatPeak = flatCum;
    const dd = flatPeak - flatCum; // drawdown in percentage-points off the high-water mark
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;
  }
  const cumulativeReturnPct = flatCum;

  // ── Idealized compounding curve (clearly labeled as an upper-bound estimate) ──
  // Assumes perfectly sequential trades — each one risks a fraction of the
  // balance *as updated by the previous trade's outcome*, with zero overlap.
  // Real concurrent positions mean this overstates geometric growth on large
  // sample sizes (with hundreds of trades, compounding ~3% per trade compounds
  // to absurd figures). Reported for context only — `cumulativeReturnPct`
  // above is the trustworthy headline number.
  let idealizedBalance = startingBalance;
  for (const t of chrono) idealizedBalance *= (1 + t.accountPnlPct / 100);

  const byOutcome = {};
  for (const t of trades) byOutcome[t.outcome] = (byOutcome[t.outcome] || 0) + 1;
  const tp1Hits = trades.filter((t) => t.tp1Hit).length;

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    breakeven,
    winRate: Number(winRate.toFixed(1)),
    profitFactor: Number.isFinite(profitFactor) ? Number(profitFactor.toFixed(2)) : null,
    avgWinPct: Number(avgWinPct.toFixed(2)),
    avgLossPct: Number(avgLossPct.toFixed(2)),
    expectancyPct: Number(expectancyPct.toFixed(2)),
    cumulativeReturnPct: Number(cumulativeReturnPct.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    idealizedFinalBalance: Number(idealizedBalance.toFixed(2)),
    idealizedReturnPct: Number((((idealizedBalance - startingBalance) / startingBalance) * 100).toFixed(2)),
    tp1HitRate: Number(((tp1Hits / trades.length) * 100).toFixed(1)),
    avgBarsHeld: Number(average(trades.map((t) => t.barsHeld)).toFixed(1)),
    byOutcome,
  };
}

// ─── Top-level entry point ───────────────────────────────────────────────────

/**
 * runBacktest({ engine, symbols, days, stepHours, startingBalance })
 *
 *  engine          "claudeperps" | "emaperps"
 *  symbols         array of Binance perp symbols, e.g. ["BTCUSDT","ETHUSDT"]
 *                  (defaults to a fixed liquid-majors basket if omitted)
 *  days            lookback window in days (default 60, max 180 — Binance
 *                  klines history + request-volume practicality)
 *  stepHours       how many 1H candles to advance the scan cursor each
 *                  iteration (default 1 = replay every candle, matching the
 *                  live engine's effectively-continuous scanning cadence)
 *  startingBalance for the compounding equity-curve summary (default 100,
 *                  matches PAPER_START)
 */
async function runBacktest(opts = {}) {
  const engineId = String(opts.engine || "claudeperps").toLowerCase();
  const loader = ENGINES[engineId];
  if (!loader) throw new Error(`Unknown engine "${opts.engine}". Use "claudeperps" or "emaperps".`);
  const runtime = loader();

  const days = Math.max(7, Math.min(180, sanitizeNumber(opts.days, 60)));
  const stepHours = Math.max(1, Math.min(6, Math.round(sanitizeNumber(opts.stepHours, 1))));
  const startingBalance = Math.max(1, sanitizeNumber(opts.startingBalance, 100));
  const leverage = runtime.PAPER_LEVERAGE || 5;
  const alertQualityFloor = runtime.MIN_ALERT_QUALITY;
  const baseFapi = runtime.BINANCE_FAPI || "https://fapi.binance.com/fapi/v1";

  // Cap the symbol count — each symbol costs 2 paginated kline fetches (1H+4H)
  // plus a full bar-by-bar replay. Vercel's function budget (maxDuration: 60s
  // in vercel.json) bounds how much we can chew through in one request; 12
  // symbols × 180 days comfortably fits with margin for cold starts.
  const MAX_SYMBOLS = 12;
  const symbols = (Array.isArray(opts.symbols) && opts.symbols.length)
    ? opts.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean).slice(0, MAX_SYMBOLS)
    : ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT"];

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  // Pull extra warmup history so the first in-window candle has a full 60-bar lookback.
  const warmupMs = (WARMUP_1H + 10) * 60 * 60 * 1000;
  const fetchStartMs = startMs - warmupMs;
  const htfWarmupMs = 60 * 4 * 60 * 60 * 1000;

  const perSymbol = [];
  const errors = [];

  for (const symbol of symbols) {
    try {
      const [candles1h, candles4h, ticker] = await Promise.all([
        fetchKlinesRange(baseFapi, symbol, "1h", fetchStartMs, endMs),
        fetchKlinesRange(baseFapi, symbol, "4h", fetchStartMs - htfWarmupMs, endMs),
        fetchLatestTicker(baseFapi, symbol),
      ]);
      if (candles1h.length < WARMUP_1H + 5) {
        errors.push({ symbol, error: "Insufficient 1H history returned." });
        continue;
      }
      const trades = await replaySymbol(symbol, candles1h, candles4h, ticker, runtime, {
        stepHours, leverage, alertQualityFloor,
      });
      perSymbol.push({
        symbol,
        candleCount: candles1h.length,
        trades: trades.length,
        summary: summarize(trades, startingBalance),
        tradeLog: trades.map((t) => ({
          side: t.side,
          quality: t.quality,
          entryTime: new Date(t.entryTime * 1000).toISOString(),
          outcome: t.outcome,
          pnlPct: Number(t.pnlPct.toFixed(2)),
          accountPnlPct: Number(t.accountPnlPct.toFixed(2)),
          sizePct: Number((t.sizePct * 100).toFixed(1)),
          barsHeld: t.barsHeld,
          tp1Hit: t.tp1Hit,
        })),
      });
    } catch (err) {
      errors.push({ symbol, error: err.message || String(err) });
    }
  }

  // Rebuild a flat trade list with the fields summarize() needs, from per-symbol replays.
  // (We kept the raw arrays out of perSymbol to avoid shipping duplicated payloads —
  // recompute the combined view from tradeLog using the same accountPnlPct figures.)
  const combinedTrades = perSymbol.flatMap((ps) =>
    ps.tradeLog.map((t) => ({
      entryTime: new Date(t.entryTime).getTime() / 1000,
      accountPnlPct: t.accountPnlPct,
      tp1Hit: t.tp1Hit,
      outcome: t.outcome,
      barsHeld: t.barsHeld,
    }))
  );

  return {
    engine: engineId,
    strategyId: runtime.STRATEGY_ID,
    params: { days, stepHours, symbols, startingBalance, leverage, alertQualityFloor },
    generatedAt: Date.now(),
    overall: summarize(combinedTrades, startingBalance),
    perSymbol,
    errors,
    notes: [
      "Funding-rate carry is not modeled (fed as 0 / neutral, matching live's neutral-funding path).",
      "24h quote-volume gate uses the *current* live ticker snapshot, not a true historical value.",
      "One open simulated position per symbol+side at a time — new signals on an already-open side are skipped until it resolves.",
      "Per-trade accountPnlPct assumes a flat starting balance (no compounding) for apples-to-apples comparison.",
      "cumulativeReturnPct / maxDrawdownPct are the trustworthy headline figures — flat-sum of each trade's account-fraction PnL against the original balance. This avoids overstating results from overlapping positions (the live engine runs up to PAPER_MAX_POS concurrent trades sharing one capital pool; naive sequential compounding would double/triple-count that capital).",
      "idealizedFinalBalance / idealizedReturnPct assume perfectly sequential, non-overlapping trades reinvesting 100% of the updated balance each time — an theoretical upper bound that compounds to extreme figures on large sample sizes. Provided for context only; do not treat as an expected outcome.",
    ],
  };
}

module.exports = {
  runBacktest,
};
