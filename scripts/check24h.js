"use strict";
const { getRuntimeState } = require("../lib/neon-db");
require("dotenv").config({ path: ".env" });

(async () => {
  const row    = await getRuntimeState("meme-autoscan");
  const trades = row?.state?.paperTrades?.trades || [];
  const now    = Date.now();
  const s24    = now - 86400000;

  const open   = trades.filter(t => t.status === "open");
  const closed = trades.filter(t => t.status !== "open");
  const recent = closed.filter(t => (t.closedAt || 0) >= s24 || (t.realTrade?.closedAt || 0) >= s24);

  console.log("\n=== OPEN TRADES (" + open.length + ") ===");
  for (const t of open) {
    const rt  = t.realTrade;
    const age = Math.round((now - (t.openedAt || now)) / 60000);
    const cur = t.currentPrice ? ("$" + parseFloat(t.currentPrice).toExponential(3)) : "no price";
    const pct = t.currentPrice && t.entryPrice
      ? ((t.currentPrice / t.entryPrice - 1) * 100).toFixed(1) + "%" : "?";
    console.log(
      " ", t.symbol,
      "| real:", rt?.status || "none",
      "| age:", age + "m",
      "| price:", cur, "(", pct, ")",
      "| p1:", !!t.partialExit1Done,
      "| p2:", !!t.partialExit2Done
    );
  }

  console.log("\n=== CLOSED LAST 24H (" + recent.length + ") ===");
  let tIn = 0, tOut = 0, wins = 0, losses = 0;
  for (const t of recent) {
    const rt       = t.realTrade;
    const pIn      = rt?.usdcSpent || 0;
    const partials = (rt?.partialExits || []).reduce((s, p) => s + (p.usdcReceived || 0), 0);
    const pOut     = (rt?.usdcReceived || 0) + partials;
    const net      = pOut - pIn;
    if (pIn > 0) { tIn += pIn; tOut += pOut; }
    if (net >= 0) wins++; else losses++;
    const icon = net >= 0 ? "✅" : "❌";
    console.log(
      icon, t.symbol,
      "| reason:", t.closeReason || "?",
      "| real:", rt?.status || "none",
      "| in: $" + pIn.toFixed(2),
      "| out: $" + pOut.toFixed(2),
      "| net:", (net >= 0 ? "+" : "") + net.toFixed(2)
    );
  }

  const net24 = tOut - tIn;
  console.log("\n=== 24H SUMMARY ===");
  console.log(" Trades:", recent.length, "| Wins:", wins, "| Losses:", losses,
    "| Win rate:", recent.length ? Math.round(wins / recent.length * 100) + "%" : "n/a");
  console.log(" Total in:  $" + tIn.toFixed(2));
  console.log(" Total out: $" + tOut.toFixed(2));
  console.log(" Net P&L:  ", (net24 >= 0 ? "+" : "") + "$" + net24.toFixed(2));
  console.log(" Last daily report:", row?.state?._lastDailyReportAt
    ? new Date(row.state._lastDailyReportAt).toISOString() : "never");
  console.log(" All-time trades:", trades.length, "| Open:", open.length, "| Closed:", closed.length);
})().catch(e => console.error("Error:", e.message));
