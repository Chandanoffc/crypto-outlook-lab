"use strict";
/**
 * zencalls-scan.js — price monitor for ZenCalls conviction calls.
 * Fetches live Binance perp prices for all open calls, auto-marks TP1/TP2/SL,
 * and fires Discord alerts when a level is hit.
 *
 * Levels are checked in priority order:
 *   SL first (protects capital), then TP2, then TP1.
 * Once a call is marked, it won't re-alert until manually reopened.
 */

const BINANCE_FAPI = "https://fapi.binance.com/fapi/v1/ticker/price";

async function fetchPrices(symbols) {
  if (!symbols.length) return {};
  try {
    const url = symbols.length === 1
      ? `${BINANCE_FAPI}?symbol=${symbols[0]}`
      : BINANCE_FAPI;
    const res = await fetch(url);
    const data = await res.json();
    const rows = Array.isArray(data) ? data : [data];
    const map = {};
    for (const r of rows) {
      if (r.symbol && r.price) map[r.symbol] = parseFloat(r.price);
    }
    return map;
  } catch {
    return {};
  }
}

async function sendStatusAlert(webhook, call, newStatus) {
  if (!webhook) return;
  const labels = { tp1: "TP1 Hit ✅", tp2: "TP2 Hit 🎯", sl: "SL Hit ❌" };
  const colors = { tp1: 0x22c55e, tp2: 0x22c55e, sl: 0xef4444 };
  const sideEmoji = call.side === "long" ? "🟢" : "🔴";
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: `${sideEmoji} ${call.symbol} — ${labels[newStatus] || newStatus}`,
          color: colors[newStatus] ?? 0x6b7280,
          fields: [
            { name: "Pattern",   value: call.pattern || "—", inline: false },
            { name: "Entry",     value: String(call.entry ?? "—"),  inline: true },
            { name: "Hit Level", value: String(call[newStatus] ?? "—"), inline: true },
            { name: "Side / TF", value: `${call.side.toUpperCase()} · ${call.timeframe}`, inline: true },
            ...(call.note ? [{ name: "Note", value: call.note.slice(0, 300), inline: false }] : []),
          ],
          footer: { text: "ZenCalls Auto-Monitor" },
          timestamp: new Date().toISOString(),
        }],
      }),
    });
  } catch { /* non-fatal */ }
}

/**
 * Run one scan cycle over all open ZenCalls.
 * Mutates `state.calls` in place and returns a summary.
 */
async function runZenCalls_Scan(state) {
  const openCalls = (state.calls || []).filter(c => c.status === "open");
  if (!openCalls.length) return { hits: 0 };

  const symbols = [...new Set(openCalls.map(c => c.symbol.toUpperCase()))];
  const prices = await fetchPrices(symbols);

  const webhook = state.settings?.discordWebhook || "";
  let hits = 0;

  for (const call of openCalls) {
    const price = prices[call.symbol.toUpperCase()];
    if (price == null) continue;

    const isLong = call.side === "long";
    let newStatus = null;

    // SL check (highest priority)
    if (call.sl != null) {
      const slHit = isLong ? price <= call.sl : price >= call.sl;
      if (slHit) { newStatus = "sl"; }
    }

    // TP2 check
    if (!newStatus && call.tp2 != null) {
      const tp2Hit = isLong ? price >= call.tp2 : price <= call.tp2;
      if (tp2Hit) { newStatus = "tp2"; }
    }

    // TP1 check (only if TP2 not hit)
    if (!newStatus && call.tp1 != null) {
      const tp1Hit = isLong ? price >= call.tp1 : price <= call.tp1;
      if (tp1Hit) { newStatus = "tp1"; }
    }

    if (newStatus) {
      // Mutate the call in state
      const idx = state.calls.findIndex(c => c.id === call.id);
      if (idx !== -1) {
        state.calls[idx].status = newStatus;
        state.calls[idx].closedAt = Date.now();
      }
      await sendStatusAlert(webhook, call, newStatus);
      hits++;
    }
  }

  return { hits, pricesChecked: Object.keys(prices).length };
}

module.exports = { runZenCalls_Scan };
