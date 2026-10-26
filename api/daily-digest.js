"use strict";

/**
 * daily-digest.js
 *
 * Called daily at 09:00 UTC by GitHub Actions.
 * Loads both strategy states from NeonDB, computes performance metrics,
 * generates data-driven improvement suggestions, and posts a rich summary
 * to the shared Discord webhook.
 *
 * Metrics computed:
 *  - Signal outcome win rate (Discord-alerted signals only)
 *  - TP1/TP2/SL breakdown, pending count
 *  - Paper trade: balance, return %, profit factor, win rate
 *  - $100 → $1000 challenge progress + days-to-target projection
 *  - Per-pattern win rate table (EMAPerps)
 *  - Quality-tier win rate table (both)
 *  - Auto-generated improvement suggestions from rules
 */

const { hasDatabase, getRuntimeState } = require("../lib/neon-db");
const { MIN_ALERT_QUALITY } = require("../lib/emaperps-runtime");
const { STARTING_BALANCE: MEME_START } = require("../lib/meme-papertrades");

const CHALLENGE_TARGET = 1000;
const CHALLENGE_START  = 100;

// ─── Auth ─────────────────────────────────────────────────────────────────────

function readAuthToken(req) {
  const header = String(req.headers?.authorization || "");
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function requireAuthorized(req) {
  const expected =
    String(process.env.UPBIT_CRON_SECRET || "").trim() ||
    String(process.env.HOUSE_CRON_SECRET || "").trim() ||
    String(process.env.CRON_SECRET       || "").trim();
  if (!expected) throw new Error("No CRON_SECRET configured.");
  const actual = readAuthToken(req);
  if (!actual || actual !== expected) {
    const err = new Error("Unauthorized"); err.statusCode = 401; throw err;
  }
}

// ─── Stats helpers ────────────────────────────────────────────────────────────

function computeSignalStats(signals = []) {
  const alerted  = signals.filter(s => s.alertedAt > 0);
  const resolved = alerted.filter(s => s.outcome != null);
  const wins     = resolved.filter(s => s.outcome === "TP1" || s.outcome === "TP2");
  const tp2s     = resolved.filter(s => s.outcome === "TP2");
  const losses   = resolved.filter(s => s.outcome === "SL");
  const pending  = alerted.filter(s => !s.outcomeSent);
  const avgQ     = alerted.length
    ? Math.round(alerted.reduce((a, s) => a + s.quality, 0) / alerted.length) : null;
  const winRate  = resolved.length ? Math.round(wins.length   / resolved.length * 100) : null;
  const tp2Rate  = resolved.length ? Math.round(tp2s.length   / resolved.length * 100) : null;

  // Last 24h
  const cutoff24h = Date.now() - 86_400_000;
  const last24h   = alerted.filter(s => s.alertedAt > cutoff24h);

  return { alerted, resolved, wins, tp2s, losses, pending, avgQ, winRate, tp2Rate, last24h };
}

function computePaperStats(paper = {}) {
  const closed     = paper.closedTrades || [];
  const balance    = paper.balance       || CHALLENGE_START;
  const starting   = paper.startingBalance || CHALLENGE_START;
  const wins       = closed.filter(t => (t.pnl ?? 0) > 0);
  const losses     = closed.filter(t => (t.pnl ?? 0) <= 0);
  const grossProfit = wins.reduce((a, t) => a + (t.pnl || 0), 0);
  const grossLoss   = Math.abs(losses.reduce((a, t) => a + (t.pnl || 0), 0));
  const pf          = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 99 : null);
  const winRate     = closed.length ? Math.round(wins.length / closed.length * 100) : null;
  const totalReturn = ((balance - starting) / starting) * 100;
  const avgWin      = wins.length   ? wins.reduce((a, t) => a + (t.pnlPct || 0), 0) / wins.length   : null;
  const avgLoss     = losses.length ? losses.reduce((a, t) => a + (t.pnlPct || 0), 0) / losses.length : null;

  // Challenge projection: based on last-7-days daily compounding rate
  const cutoff7d = Date.now() - 7 * 86_400_000;
  const recent   = closed.filter(t => (t.closedAt || 0) > cutoff7d);
  const recentReturn7d = recent.reduce((a, t) => a + (t.pnl || 0), 0);
  const dailyAvgGain = recentReturn7d / 7; // avg $ gain per day
  const daysToTarget  = dailyAvgGain > 0
    ? Math.ceil((CHALLENGE_TARGET - balance) / dailyAvgGain) : null;

  return { closed, balance, starting, totalReturn, wins, losses, pf, winRate, avgWin, avgLoss, dailyAvgGain, daysToTarget };
}

// Quality-tier breakdown. Every alerted signal is >= MIN_ALERT_QUALITY (95),
// and the real achievable ceiling is 118 (85 highest base quality + 33 from
// every bonus stacking) — mirrors the Good/Strong/Elite split used in
// emaperps.js's activeQualityLabel().
function qualityTierBreakdown(signals = []) {
  const alerted = signals.filter(s => s.alertedAt > 0);
  const tiers = [
    { label: "Q95-99",  min: 95,  max: 99 },
    { label: "Q100-109", min: 100, max: 109 },
    { label: "Q110+",   min: 110, max: 999 },
  ];
  return tiers.map(({ label, min, max }) => {
    const sigs = alerted.filter(s => s.quality >= min && s.quality <= max);
    const res  = sigs.filter(s => s.outcome != null);
    const w    = res.filter(s => s.outcome === "TP1" || s.outcome === "TP2").length;
    const l    = res.filter(s => s.outcome === "SL").length;
    const wr   = res.length ? Math.round(w / res.length * 100) : null;
    return { label, count: sigs.length, wins: w, losses: l, winRate: wr };
  }).filter(t => t.count > 0);
}

// EMAPerps pattern breakdown
function patternBreakdown(signals = []) {
  const alerted = signals.filter(s => s.alertedAt > 0 && s.signalType);
  const types   = [...new Set(alerted.map(s => s.signalType))];
  return types.map(pt => {
    const sigs = alerted.filter(s => s.signalType === pt);
    const res  = sigs.filter(s => s.outcome != null);
    const w    = res.filter(s => s.outcome === "TP1" || s.outcome === "TP2").length;
    const l    = res.filter(s => s.outcome === "SL").length;
    const wr   = res.length ? Math.round(w / res.length * 100) : null;
    return { type: pt, count: sigs.length, wins: w, losses: l, winRate: wr };
  }).sort((a, b) => b.count - a.count);
}

// ─── MemeScreener paper stats ─────────────────────────────────────────────────

function computeMemePaperStats(paperTrades = {}) {
  const trades  = paperTrades.trades || [];
  const balance = paperTrades.balance ?? MEME_START;
  const open    = trades.filter(t => t.status === "open");
  const closed  = trades.filter(t => t.status !== "open");
  const wins    = closed.filter(t => t.status === "win");
  const losses  = closed.filter(t => t.status !== "win");
  const totalPnl   = closed.reduce((s, t) => s + (t.pnl || 0), 0);
  const winRate    = closed.length ? Math.round(wins.length / closed.length * 100) : null;
  const totalReturn = ((balance - MEME_START) / MEME_START) * 100;

  // Yesterday's daily log entry (index 0 after roll, or today's partial)
  const today     = new Date().toISOString().slice(0, 10);
  const dailyLog  = paperTrades.dailyLog || [];
  const yesterday = dailyLog[0] || null;

  // Today's partial stats from trades closed today
  const todayClosed = closed.filter(t => t.closedAt && new Date(t.closedAt).toISOString().slice(0, 10) === today);
  const todayWins   = todayClosed.filter(t => t.status === "win");
  const todayPnl    = todayClosed.reduce((s, t) => s + (t.pnl || 0), 0);
  const dayStart    = paperTrades._dayStartBalance ?? MEME_START;

  // Rich per-trade list for today (from live trades array, not dailyLog snapshot)
  const todayTradeRecords = todayClosed.map(t => ({
    symbol:      t.symbol || t.name || (t.mint || "").slice(0, 8),
    status:      t.status,
    pnl:         t.pnl,
    pnlPct:      t.pnlPct,
    holdMs:      t.holdMs || (t.closedAt && t.openedAt ? t.closedAt - t.openedAt : null),
    source:      t.source || null,
    detected_mc: t.detected_mc || null,
    pair_url:    t.pair_url || null,
  }));

  const bySource = {};
  const byMcTier = {};
  const mcTier = mc => !mc ? "unknown" : mc < 100_000 ? "<$100K" : mc < 500_000 ? "$100K-500K" : "$500K-3M";
  for (const t of todayClosed) {
    const s = t.source || "unknown";
    if (!bySource[s]) bySource[s] = { trades: 0, wins: 0, pnl: 0 };
    bySource[s].trades++; if (t.status === "win") bySource[s].wins++; bySource[s].pnl += t.pnl || 0;
    const k = mcTier(t.detected_mc);
    if (!byMcTier[k]) byMcTier[k] = { trades: 0, wins: 0, pnl: 0 };
    byMcTier[k].trades++; if (t.status === "win") byMcTier[k].wins++; byMcTier[k].pnl += t.pnl || 0;
  }
  const avgHoldWinMs  = todayWins.length   ? todayWins.reduce((s, t) => s + (t.holdMs || 0), 0) / todayWins.length   : null;
  const avgHoldLossMs = (todayClosed.length - todayWins.length) > 0
    ? todayClosed.filter(t => t.status !== "win").reduce((s, t) => s + (t.holdMs || 0), 0) / (todayClosed.length - todayWins.length)
    : null;
  const topWin  = todayWins.length   ? Math.max(...todayWins.map(t => t.pnl  || 0)) : null;
  const topLoss = todayClosed.filter(t => t.status !== "win").length
    ? Math.min(...todayClosed.filter(t => t.status !== "win").map(t => t.pnl || 0)) : null;

  return { balance, totalReturn, totalPnl, open: open.length, closed: closed.length, wins: wins.length, losses: losses.length, winRate, yesterday, today: { date: today, trades: todayClosed.length, wins: todayWins.length, losses: todayClosed.length - todayWins.length, pnl: Math.round(todayPnl * 100) / 100, openingBalance: dayStart, closingBalance: balance, winRate: todayClosed.length ? Math.round(todayWins.length / todayClosed.length * 100) : null, trades: todayTradeRecords, bySource, byMcTier, avgHoldWinMs, avgHoldLossMs, topWin, topLoss } };
}

// ─── Suggestion engine ────────────────────────────────────────────────────────

function generateSuggestions(epSig, epPaper, epPatterns, epTiers) {
  const suggestions = [];

  // ── EMAPerps signal quality ──
  if (epSig.winRate != null && epSig.winRate < 40 && epSig.resolved.length >= 5) {
    suggestions.push({ strategy: "EMAPerps", severity: "⚠️", text: `Win rate is ${epSig.winRate}% on ${epSig.resolved.length} resolved signals — below breakeven for 2:1 R:R. Consider raising MIN_ALERT_QUALITY from ${MIN_ALERT_QUALITY} further.` });
  }
  if (epSig.last24h.length === 0) {
    suggestions.push({ strategy: "EMAPerps", severity: "⚠️", text: `No new signals in the last 24h — the TP1/TP2 minimum distance filter may be too restrictive for current market conditions.` });
  }

  // ── EMAPerps pattern analysis ──
  const weakPatterns  = epPatterns.filter(p => p.winRate != null && p.winRate <= 35 && p.count >= 3);
  const strongPatterns = epPatterns.filter(p => p.winRate != null && p.winRate >= 65 && p.count >= 3);
  if (weakPatterns.length > 0) {
    suggestions.push({ strategy: "EMAPerps", severity: "⚠️", text: `Weak patterns: ${weakPatterns.map(p => `${p.type} (${p.winRate}% WR, ${p.count} trades)`).join(", ")}. These signal types are consistently losing — consider raising their quality threshold or disabling them.` });
  }
  if (strongPatterns.length > 0) {
    suggestions.push({ strategy: "EMAPerps", severity: "✅", text: `Strong patterns: ${strongPatterns.map(p => `${p.type} (${p.winRate}% WR, ${p.count} trades)`).join(", ")}. Focus on these signal types for best results.` });
  }

  // ── EMAPerps quality tiers ──
  epTiers.forEach(t => {
    if (t.winRate != null && t.winRate <= 35 && t.count >= 3) {
      suggestions.push({ strategy: "EMAPerps", severity: "⚠️", text: `Quality tier ${t.label}: only ${t.winRate}% win rate on ${t.count} signals (${t.wins}W/${t.losses}L). These low-quality signals are dragging down results — consider raising MIN_ALERT_QUALITY further.` });
    }
    if (t.winRate != null && t.winRate >= 65 && t.count >= 3) {
      suggestions.push({ strategy: "EMAPerps", severity: "✅", text: `Quality tier ${t.label}: ${t.winRate}% win rate on ${t.count} signals. Elite tier — consider increasing conviction sizing for these.` });
    }
  });

  // ── $100→$1000 challenge ──
  if (epPaper.daysToTarget != null && epPaper.daysToTarget <= 14) {
    suggestions.push({ strategy: "Challenge", severity: "🎯", text: `At current pace EMAPerps reaches $1000 in ~${epPaper.daysToTarget} days.` });
  }
  if ((epPaper.daysToTarget == null || epPaper.daysToTarget > 30) && epPaper.closed.length > 5) {
    suggestions.push({ strategy: "Challenge", severity: "⚠️", text: `Current daily gain rate is too slow for the $100→$1000 target in 2 weeks. Signal quality and target sizing need to improve, or trade frequency needs to increase.` });
  }

  // Fallback if no data yet
  if (epSig.alerted.length === 0) {
    suggestions.push({ strategy: "General", severity: "💡", text: `No alerted signals recorded yet — make sure Discord webhook is configured and the quality gate is passing. Run a manual scan to verify.` });
  }

  return suggestions;
}

// ─── Discord formatter ────────────────────────────────────────────────────────

function fPct(v, digits = 1) {
  if (v == null) return "–";
  return (v >= 0 ? "+" : "") + Number(v).toFixed(digits) + "%";
}

function challengeBar(balance, target = CHALLENGE_TARGET, start = CHALLENGE_START) {
  const pct = Math.max(0, Math.min(1, (balance - start) / (target - start)));
  const filled = Math.round(pct * 20);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  return `[${bar}] ${Math.round(pct * 100)}%`;
}

function buildDiscordMessage(epSig, epPaper, epPatterns, suggestions, runDate, memePaper) {
  const lines = [];

  lines.push(`📊 **SOLORIS DAILY REPORT** — ${runDate}`);
  lines.push("```");

  // ── EMAPerps ──
  lines.push("EMA PERPS (EMA Pullback)");
  lines.push(`  Alerted: ${epSig.alerted.length}  Resolved: ${epSig.resolved.length}  Pending: ${epSig.pending.length}`);
  lines.push(`  Win Rate: ${epSig.winRate != null ? epSig.winRate + "%" : "–"}  TP2 Rate: ${epSig.tp2Rate != null ? epSig.tp2Rate + "%" : "–"}  Avg Q: ${epSig.avgQ != null ? "Q" + epSig.avgQ : "–"}`);
  lines.push(`  24h signals: ${epSig.last24h.length}`);
  lines.push(`  Paper: $${epPaper.balance.toFixed(2)} (${fPct(epPaper.totalReturn)})  Trades: ${epPaper.closed.length}  WR: ${epPaper.winRate != null ? epPaper.winRate + "%" : "–"}  PF: ${epPaper.pf != null ? (epPaper.pf >= 99 ? "∞" : epPaper.pf.toFixed(2)) : "–"}`);
  if (epPaper.avgWin != null)  lines.push(`  Avg Win: ${fPct(epPaper.avgWin)}  Avg Loss: ${fPct(epPaper.avgLoss)}`);

  if (epPatterns.length > 0) {
    lines.push("");
    lines.push("  Top patterns (EMA):");
    epPatterns.slice(0, 6).forEach(p => {
      const wr = p.winRate != null ? `${p.winRate}% WR` : "no data";
      lines.push(`    ${p.type.padEnd(3)} ${p.count}x  ${wr}  (${p.wins}W/${p.losses}L)`);
    });
  }

  lines.push("```");

  // ── $100→$1000 Challenge ──
  lines.push("🎯 **$100 → $1000 CHALLENGE**");
  lines.push("```");
  lines.push(`EMA Perps: $${epPaper.balance.toFixed(2)} / $${CHALLENGE_TARGET}`);
  lines.push(challengeBar(epPaper.balance));
  if (epPaper.daysToTarget != null && epPaper.dailyAvgGain > 0) {
    lines.push(`Projected: ~${epPaper.daysToTarget} days at current rate ($${epPaper.dailyAvgGain.toFixed(2)}/day)`);
  }
  lines.push("```");

  // ── Suggestions ──
  if (suggestions.length > 0) {
    lines.push("💡 **TODAY'S IMPROVEMENT NOTES**");
    suggestions.forEach(s => {
      lines.push(`${s.severity} **[${s.strategy}]** ${s.text}`);
    });
  }

  // ── MemeScreener Paper Trading ──
  if (memePaper) {
    const d = memePaper.today;
    const fMs = ms => {
      if (!ms) return "—";
      const m = Math.round(ms / 60000);
      return m >= 60 ? `${Math.floor(m/60)}h${m%60 ? m%60+"m" : ""}` : `${m}m`;
    };
    const fMc = mc => !mc ? "—" : mc >= 1_000_000 ? `$${(mc/1_000_000).toFixed(1)}M` : `$${Math.round(mc/1000)}K`;
    const fSign = v => v == null ? "—" : (v >= 0 ? "+" : "") + "$" + Math.abs(v).toFixed(2);

    lines.push("🪙 **MEMESCREENER — TODAY'S PAPER TRADING**");
    lines.push("```");
    lines.push(`Date             ${d.date}`);
    lines.push(`Opening balance  $${(d.openingBalance || MEME_START).toFixed(2)}`);
    lines.push(`Closing balance  $${memePaper.balance.toFixed(2)}   (${fPct((memePaper.balance - (d.openingBalance || MEME_START)) / (d.openingBalance || MEME_START) * 100)} today)`);
    lines.push(`P&L today        ${fSign(d.pnl)}`);
    lines.push(`Trades today     ${d.trades}  ·  ${d.wins}W / ${d.losses}L  ·  WR: ${d.winRate != null ? d.winRate + "%" : "–"}`);
    lines.push(`Open positions   ${memePaper.open}`);
    lines.push(`All-time         $${memePaper.balance.toFixed(2)}  (${fPct(memePaper.totalReturn)} from $${MEME_START})  ·  ${memePaper.wins}W/${memePaper.losses}L  ·  ${memePaper.winRate != null ? memePaper.winRate + "% WR" : "–"}`);
    lines.push("```");

    // Per-token trade record
    if (d.trades && d.trades.length > 0) {
      lines.push("**📋 Token-by-token record**");
      lines.push("```");
      lines.push("Token          Result    P&L       Hold    MC at entry");
      lines.push("─────────────────────────────────────────────────────");
      for (const t of d.trades) {
        const sym    = (t.symbol || "?").padEnd(13).slice(0, 13);
        const res    = t.status === "win" ? "WIN  ✓" : t.status === "loss" ? "LOSS ✗" : "EXPIR";
        const pnl    = (t.pnl >= 0 ? "+" : "") + "$" + Math.abs(t.pnl || 0).toFixed(2);
        const hold   = fMs(t.holdMs);
        const mc     = fMc(t.detected_mc);
        lines.push(`${sym}  ${res}    ${pnl.padEnd(8)}  ${hold.padEnd(6)}  ${mc}`);
      }
      lines.push("```");

      // What worked best — source breakdown
      const src = d.bySource || {};
      if (Object.keys(src).length > 1) {
        lines.push("**🔍 What worked — by discovery source**");
        lines.push("```");
        for (const [s, v] of Object.entries(src)) {
          const label = s === "dexscreener_boost" ? "DS Boost  " : s === "dexscreener" ? "DS Profile" : s.padEnd(10);
          const wr    = v.trades ? Math.round(v.wins / v.trades * 100) + "%" : "—";
          lines.push(`${label}  ${v.trades} trades  ${v.wins}W/${v.trades-v.wins}L  WR:${wr}  P&L:${fSign(v.pnl)}`);
        }
        lines.push("```");
      }

      // MC tier breakdown
      const tiers = d.byMcTier || {};
      if (Object.keys(tiers).length > 0) {
        lines.push("**💰 What worked — by market cap at detection**");
        lines.push("```");
        const tierOrder = ["<$100K", "$100K-500K", "$500K-3M", "unknown"];
        for (const k of tierOrder) {
          if (!tiers[k]) continue;
          const v  = tiers[k];
          const wr = v.trades ? Math.round(v.wins / v.trades * 100) + "%" : "—";
          lines.push(`${k.padEnd(12)}  ${v.trades} trades  ${v.wins}W/${v.trades-v.wins}L  WR:${wr}  P&L:${fSign(v.pnl)}`);
        }
        lines.push("```");
      }

      // Hold time insight
      if (d.avgHoldWinMs || d.avgHoldLossMs) {
        lines.push("**⏱ Hold time**");
        lines.push("```");
        if (d.avgHoldWinMs)  lines.push(`Avg hold (wins):    ${fMs(d.avgHoldWinMs)}`);
        if (d.avgHoldLossMs) lines.push(`Avg hold (losses):  ${fMs(d.avgHoldLossMs)}`);
        if (d.topWin  != null) lines.push(`Best trade:         +$${d.topWin.toFixed(2)}`);
        if (d.topLoss != null) lines.push(`Worst trade:        $${d.topLoss.toFixed(2)}`);
        lines.push("```");
      }
    }

    // Yesterday's summary row
    if (memePaper.yesterday && memePaper.yesterday.date !== d.date) {
      const y = memePaper.yesterday;
      lines.push(`_Yesterday (${y.date}): $${y.openingBalance.toFixed(2)} → $${y.closingBalance.toFixed(2)} · ${fSign(y.pnl)} · ${y.trades} trades (${y.wins}W/${y.losses}L · ${y.winRate != null ? y.winRate + "% WR" : "–"})_`);
    }
  }

  lines.push(`\n_soloris-signals.vercel.app_`);

  return lines.join("\n");
}

// ─── Main handler ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: "Method not allowed." }));
  }

  // Auth check (same secret as upbit-cron)
  try { requireAuthorized(req); }
  catch (err) {
    res.statusCode = err.statusCode || 500;
    return res.end(JSON.stringify({ error: err.message }));
  }

  if (!hasDatabase()) {
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: false, reason: "No database configured." }));
  }

  try {
    // Load EMAPerps strategy state
    const epStored = await getRuntimeState("emaperps").catch(() => ({ found: false }));
    const epState  = epStored.found ? (epStored.state || {}) : {};

    // Load MemeScreener autoscan state
    const memeStored = await getRuntimeState("meme-autoscan").catch(() => null);
    const memeState  = memeStored?.state || {};
    const memePaper  = memeState.paperTrades ? computeMemePaperStats(memeState.paperTrades) : null;

    // Compute metrics
    const epSig      = computeSignalStats(epState.signals || []);
    const epPaper    = computePaperStats(epState.paper   || {});
    const epPatterns = patternBreakdown(epState.signals || []);
    const epTiers    = qualityTierBreakdown(epState.signals || []);

    const suggestions = generateSuggestions(epSig, epPaper, epPatterns, epTiers);
    const runDate     = new Date().toISOString().slice(0, 10);
    const message     = buildDiscordMessage(epSig, epPaper, epPatterns, suggestions, runDate, memePaper);

    // Send to Discord
    const webhook = String(process.env.UPBIT_DISCORD_WEBHOOK || process.env.DISCORD_WEBHOOK || "").trim();
    let discordResult = "no webhook configured";
    if (webhook) {
      try {
        const resp = await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: message }),
        });
        discordResult = resp.ok ? "sent" : `HTTP ${resp.status}`;
      } catch (err) {
        discordResult = err.message;
      }
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      ok: true,
      runDate,
      discord: discordResult,
      suggestionCount: suggestions.length,
      suggestions: suggestions.map(s => `${s.severity} [${s.strategy}] ${s.text}`),
      metrics: {
        emaperps: {
          signals: { alerted: epSig.alerted.length, resolved: epSig.resolved.length, winRate: epSig.winRate, tp2Rate: epSig.tp2Rate },
          paper: { balance: epPaper.balance, totalReturn: epPaper.totalReturn, winRate: epPaper.winRate, pf: epPaper.pf },
        },
      },
    }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
};
