"use strict";
/**
 * zencalls-papertrades.js
 * Auto paper-trades every signal from the strategy scanner.
 * Tracks TP1 / TP2 / SL hits via Binance price checks in cron.
 *
 * State key: "zencalls-papertrades"
 * State shape: { trades: [...], stats: {...} }
 *
 * Trade shape:
 *   id, symbol, pattern, side, entry, tp1, tp2, sl, rr_target
 *   status: "open" | "tp1_hit" | "tp2_hit" | "sl_hit" | "expired"
 *   detectedAt, closedAt, exit_price, pnl_pct, rr_achieved
 */

const FAPI_BASE     = "https://fapi.binance.com";
const MAX_TRADES    = 200;
const EXPIRE_DAYS   = 7;        // auto-close open trades after 7 days

// ── Helpers ───────────────────────────────────────────────

function defaultState() {
  return { trades: [] };
}

function calcStats(trades) {
  const closed = trades.filter(t => t.status !== "open");
  const wins   = closed.filter(t => t.status === "tp1_hit" || t.status === "tp2_hit");
  const losses = closed.filter(t => t.status === "sl_hit");
  const open   = trades.filter(t => t.status === "open");

  const winRate  = closed.length ? (wins.length / closed.length) * 100 : null;
  const avgPnl   = closed.length ? closed.reduce((s, t) => s + (t.pnl_pct || 0), 0) / closed.length : null;
  const totalPnl = closed.reduce((s, t) => s + (t.pnl_pct || 0), 0);
  const avgRR    = wins.length   ? wins.reduce((s, t) => s + (t.rr_achieved || 0), 0) / wins.length : null;
  const best     = closed.reduce((b, t) => (t.pnl_pct || 0) > (b?.pnl_pct || -Infinity) ? t : b, null);
  const worst    = closed.reduce((w, t) => (t.pnl_pct || 0) < (w?.pnl_pct || Infinity)  ? t : w, null);

  return {
    total:      trades.length,
    open:       open.length,
    closed:     closed.length,
    wins:       wins.length,
    losses:     losses.length,
    win_rate:   winRate   != null ? Math.round(winRate * 10) / 10 : null,
    avg_pnl:    avgPnl    != null ? Math.round(avgPnl * 100) / 100 : null,
    total_pnl:  Math.round(totalPnl * 100) / 100,
    avg_rr:     avgRR     != null ? Math.round(avgRR * 100) / 100 : null,
    best_trade: best  ? { symbol: best.symbol,  pnl_pct: best.pnl_pct  } : null,
    worst_trade: worst ? { symbol: worst.symbol, pnl_pct: worst.pnl_pct } : null,
  };
}

// ── Open a new paper trade from a strategy signal ─────────

function openTrade(state, signal) {
  // Deduplicate: one open trade per symbol at a time
  if ((state.trades || []).some(t => t.symbol === signal.symbol && t.status === "open")) return;

  const rr_target = signal.entry && signal.sl && signal.tp1
    ? Math.round(((signal.tp1 - signal.entry) / (signal.entry - signal.sl)) * 100) / 100
    : signal.rr || null;

  const trade = {
    id:          signal.id || `${signal.symbol}-${Date.now()}`,
    symbol:      signal.symbol,
    pattern:     signal.pattern,
    side:        signal.side || "long",
    entry:       signal.entry,
    tp1:         signal.tp1,
    tp2:         signal.tp2,
    sl:          signal.sl,
    rr_target,
    status:      "open",
    detectedAt:  signal.detectedAt || Date.now(),
    closedAt:    null,
    exit_price:  null,
    pnl_pct:     null,
    rr_achieved: null,
  };

  state.trades = [trade, ...(state.trades || [])].slice(0, MAX_TRADES);
}

// ── Fetch current Binance perp prices ─────────────────────

async function fetchPrices(symbols) {
  if (!symbols.length) return {};
  try {
    const data = await fetch(`${FAPI_BASE}/fapi/v1/ticker/price`).then(r => r.json());
    const map  = {};
    for (const t of data) {
      if (symbols.includes(t.symbol)) map[t.symbol] = parseFloat(t.price);
    }
    return map;
  } catch { return {}; }
}

// ── Discord alert for closed trade ───────────────────────

async function sendCloseAlert(webhook, trade) {
  if (!webhook) return;
  const emoji  = trade.status === "tp2_hit" ? "🎯" : trade.status === "tp1_hit" ? "✅" : trade.status === "sl_hit" ? "❌" : "⏱";
  const labels = { tp1_hit: "TP1 Hit", tp2_hit: "TP2 Hit", sl_hit: "SL Hit", expired: "Expired" };
  const color  = (trade.status === "tp1_hit" || trade.status === "tp2_hit") ? 0x22c55e
               : trade.status === "sl_hit" ? 0xef4444 : 0x6b7280;
  const pnl    = trade.pnl_pct != null ? `${trade.pnl_pct > 0 ? "+" : ""}${trade.pnl_pct.toFixed(2)}%` : "—";
  const rr     = trade.rr_achieved != null ? `1:${trade.rr_achieved.toFixed(2)}` : "—";
  const dur    = trade.closedAt && trade.detectedAt
    ? `${Math.round((trade.closedAt - trade.detectedAt) / 3600000)}h` : "—";

  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: `${emoji} Paper Trade ${labels[trade.status] || trade.status} · ${trade.symbol}`,
          color,
          fields: [
            { name: "Pattern",    value: trade.pattern || "—",            inline: false },
            { name: "Entry",      value: String(trade.entry),             inline: true },
            { name: "Exit",       value: String(trade.exit_price || "—"), inline: true },
            { name: "P&L",        value: pnl,                            inline: true },
            { name: "R:R Target", value: `1:${trade.rr_target ?? "—"}`,  inline: true },
            { name: "R:R Actual", value: rr,                             inline: true },
            { name: "Duration",   value: dur,                            inline: true },
          ],
          footer: { text: "Soloris · ZenCalls Paper Trades" },
          timestamp: new Date().toISOString(),
        }],
      }),
    });
  } catch { /* non-fatal */ }
}

// ── Check open trades, close on TP/SL/expiry ─────────────

async function checkPaperTrades(state, { webhook } = {}) {
  const now    = Date.now();
  const trades = (state.trades || []);
  const open   = trades.filter(t => t.status === "open");
  if (!open.length) return { checked: 0, closed: 0 };

  const symbols = [...new Set(open.map(t => t.symbol))];
  const prices  = await fetchPrices(symbols);
  let closed    = 0;

  for (const trade of open) {
    const price = prices[trade.symbol];
    if (!price) continue;

    const expireMs  = EXPIRE_DAYS * 24 * 3600 * 1000;
    const isExpired = now - trade.detectedAt > expireMs;

    let newStatus  = null;
    let exitPrice  = null;

    if (trade.side === "long") {
      if      (price <= trade.sl)  { newStatus = "sl_hit";  exitPrice = trade.sl; }
      else if (price >= trade.tp2) { newStatus = "tp2_hit"; exitPrice = trade.tp2; }
      else if (price >= trade.tp1) { newStatus = "tp1_hit"; exitPrice = trade.tp1; }
      else if (isExpired)          { newStatus = "expired"; exitPrice = price; }
    } else {
      if      (price >= trade.sl)  { newStatus = "sl_hit";  exitPrice = trade.sl; }
      else if (price <= trade.tp2) { newStatus = "tp2_hit"; exitPrice = trade.tp2; }
      else if (price <= trade.tp1) { newStatus = "tp1_hit"; exitPrice = trade.tp1; }
      else if (isExpired)          { newStatus = "expired"; exitPrice = price; }
    }

    if (newStatus) {
      const pnl_pct = trade.side === "long"
        ? ((exitPrice - trade.entry) / trade.entry) * 100
        : ((trade.entry - exitPrice) / trade.entry) * 100;

      const rr_achieved = Math.abs(pnl_pct) / (Math.abs((trade.entry - trade.sl) / trade.entry) * 100);

      trade.status      = newStatus;
      trade.closedAt    = now;
      trade.exit_price  = exitPrice;
      trade.pnl_pct     = Math.round(pnl_pct * 100) / 100;
      trade.rr_achieved = Math.round(rr_achieved * 100) / 100;

      await sendCloseAlert(webhook, trade);
      closed++;
    }
  }

  return { checked: open.length, closed };
}

module.exports = { openTrade, checkPaperTrades, calcStats, defaultState };
