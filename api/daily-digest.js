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

// Quality-tier breakdown (used by both strategies)
function qualityTierBreakdown(signals = []) {
  const alerted = signals.filter(s => s.alertedAt > 0);
  const tiers = [
    { label: "Q75-79", min: 75, max: 79 },
    { label: "Q80-84", min: 80, max: 84 },
    { label: "Q85-89", min: 85, max: 89 },
    { label: "Q90+",   min: 90, max: 999 },
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

// ─── Suggestion engine ────────────────────────────────────────────────────────

function generateSuggestions(cpSig, cpPaper, epSig, epPaper, epPatterns, cpTiers, epTiers) {
  const suggestions = [];

  // ── Claudeperps signal quality ──
  if (cpSig.winRate != null && cpSig.winRate < 40 && cpSig.resolved.length >= 5) {
    suggestions.push({ strategy: "Claudeperps", severity: "⚠️", text: `Win rate is ${cpSig.winRate}% on ${cpSig.resolved.length} resolved signals — consider raising MIN_ALERT_QUALITY from 78 to 82.` });
  }
  if (cpSig.winRate != null && cpSig.winRate >= 65 && cpSig.resolved.length >= 5) {
    suggestions.push({ strategy: "Claudeperps", severity: "✅", text: `Strong win rate ${cpSig.winRate}% — strategy is performing well. No changes needed.` });
  }
  if (cpSig.tp2Rate != null && cpSig.tp2Rate >= 50) {
    suggestions.push({ strategy: "Claudeperps", severity: "💡", text: `TP2 hit rate is ${cpSig.tp2Rate}% — price is consistently reaching the full target. Consider raising TP2 from 5× to 6×ATR for bigger wins.` });
  }
  if (cpSig.tp2Rate != null && cpSig.tp2Rate <= 20 && cpSig.resolved.length >= 6) {
    suggestions.push({ strategy: "Claudeperps", severity: "💡", text: `TP2 hit rate is only ${cpSig.tp2Rate}% — price rarely reaches the full target. Consider tightening TP2 from 5×ATR to 4×ATR to capture more wins.` });
  }
  if (cpSig.pending.length > 5) {
    suggestions.push({ strategy: "Claudeperps", severity: "💡", text: `${cpSig.pending.length} signals pending outcome — outcome tracking is working but many signals haven't resolved yet. Normal if recently deployed.` });
  }
  if (cpSig.last24h.length === 0) {
    suggestions.push({ strategy: "Claudeperps", severity: "⚠️", text: `No new signals in the last 24h — check that the background scanner is running and ATR filter isn't too restrictive.` });
  }

  // ── Claudeperps paper trade ──
  if (cpPaper.pf != null && cpPaper.pf < 1.0 && cpPaper.closed.length >= 5) {
    suggestions.push({ strategy: "Claudeperps", severity: "⚠️", text: `Profit factor is ${cpPaper.pf.toFixed(2)} — losing more than winning. Review SL placement; current SL at ~1×ATR may be too tight for the 3-5×ATR targets.` });
  }
  if (cpPaper.winRate != null && cpPaper.winRate < 35 && cpPaper.closed.length >= 8) {
    suggestions.push({ strategy: "Claudeperps", severity: "⚠️", text: `Paper win rate ${cpPaper.winRate}% on ${cpPaper.closed.length} trades. With 3:1 R:R you need >25% to profit, but 35%+ is healthier. Consider adding volume confirmation as a hard filter.` });
  }

  // ── Claudeperps quality tiers ──
  cpTiers.forEach(t => {
    if (t.winRate != null && t.winRate <= 30 && t.count >= 3) {
      suggestions.push({ strategy: "Claudeperps", severity: "⚠️", text: `Quality tier ${t.label}: only ${t.winRate}% win rate on ${t.count} signals (${t.wins}W/${t.losses}L). These low-quality signals are dragging down results — raise the floor.` });
    }
    if (t.winRate != null && t.winRate >= 70 && t.count >= 3) {
      suggestions.push({ strategy: "Claudeperps", severity: "✅", text: `Quality tier ${t.label}: ${t.winRate}% win rate on ${t.count} signals. Elite tier — consider increasing position sizing for these.` });
    }
  });

  // ── EMAPerps signal quality ──
  if (epSig.winRate != null && epSig.winRate < 40 && epSig.resolved.length >= 5) {
    suggestions.push({ strategy: "EMAPerps", severity: "⚠️", text: `Win rate is ${epSig.winRate}% on ${epSig.resolved.length} resolved signals — below breakeven for 2:1 R:R. Consider raising MIN_ALERT_QUALITY from 75 to 78.` });
  }
  if (epSig.last24h.length === 0) {
    suggestions.push({ strategy: "EMAPerps", severity: "⚠️", text: `No new signals in the last 24h — the 10% R2 minimum distance filter may be too restrictive for current market conditions.` });
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

  // ── $100→$1000 challenge ──
  if (cpPaper.daysToTarget != null && cpPaper.daysToTarget <= 14) {
    suggestions.push({ strategy: "Challenge", severity: "🎯", text: `At current pace Claudeperps reaches $1000 in ~${cpPaper.daysToTarget} days. Stay consistent and avoid overriding signals.` });
  }
  if (epPaper.daysToTarget != null && epPaper.daysToTarget <= 14) {
    suggestions.push({ strategy: "Challenge", severity: "🎯", text: `At current pace EMAPerps reaches $1000 in ~${epPaper.daysToTarget} days.` });
  }
  if ((cpPaper.daysToTarget == null || cpPaper.daysToTarget > 30) &&
      (epPaper.daysToTarget == null || epPaper.daysToTarget > 30) &&
      (cpPaper.closed.length + epPaper.closed.length) > 5) {
    suggestions.push({ strategy: "Challenge", severity: "⚠️", text: `Current daily gain rate is too slow for the $100→$1000 target in 2 weeks. Signal quality and target sizing need to improve, or trade frequency needs to increase.` });
  }

  // Fallback if no data yet
  if (cpSig.alerted.length === 0 && epSig.alerted.length === 0) {
    suggestions.push({ strategy: "General", severity: "💡", text: `No alerted signals recorded yet — make sure Discord webhook is configured on both pages and the quality gate is passing. Run a manual scan to verify.` });
  }

  return suggestions;
}

// ─── Discord formatter ────────────────────────────────────────────────────────

function fPct(v, digits = 1) {
  if (v == null) return "–";
  return (v >= 0 ? "+" : "") + Number(v).toFixed(digits) + "%";
}

function challengeBar(balance, target = CHALLENGE_TARGET, start = CHALLENGE_START) {
  const pct = Math.min(1, (balance - start) / (target - start));
  const filled = Math.round(pct * 20);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  return `[${bar}] ${Math.round(pct * 100)}%`;
}

function buildDiscordMessage(cpSig, cpPaper, epSig, epPaper, epPatterns, suggestions, runDate) {
  const lines = [];

  lines.push(`📊 **SOLORIS DAILY REPORT** — ${runDate}`);
  lines.push("```");

  // ── Claudeperps ──
  lines.push("CLAUDEPERPS (Multi-TF Momentum)");
  lines.push(`  Alerted: ${cpSig.alerted.length}  Resolved: ${cpSig.resolved.length}  Pending: ${cpSig.pending.length}`);
  lines.push(`  Win Rate: ${cpSig.winRate != null ? cpSig.winRate + "%" : "–"}  TP2 Rate: ${cpSig.tp2Rate != null ? cpSig.tp2Rate + "%" : "–"}  Avg Q: ${cpSig.avgQ != null ? "Q" + cpSig.avgQ : "–"}`);
  lines.push(`  24h signals: ${cpSig.last24h.length}`);
  lines.push(`  Paper: $${cpPaper.balance.toFixed(2)} (${fPct(cpPaper.totalReturn)})  Trades: ${cpPaper.closed.length}  WR: ${cpPaper.winRate != null ? cpPaper.winRate + "%" : "–"}  PF: ${cpPaper.pf != null ? (cpPaper.pf >= 99 ? "∞" : cpPaper.pf.toFixed(2)) : "–"}`);
  if (cpPaper.avgWin != null)  lines.push(`  Avg Win: ${fPct(cpPaper.avgWin)}  Avg Loss: ${fPct(cpPaper.avgLoss)}`);
  lines.push("");

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
  lines.push(`Claudeperps: $${cpPaper.balance.toFixed(2)} / $${CHALLENGE_TARGET}`);
  lines.push(challengeBar(cpPaper.balance));
  if (cpPaper.daysToTarget != null && cpPaper.dailyAvgGain > 0) {
    lines.push(`Projected: ~${cpPaper.daysToTarget} days at current rate ($${cpPaper.dailyAvgGain.toFixed(2)}/day)`);
  }
  lines.push("");
  lines.push(`EMA Perps:    $${epPaper.balance.toFixed(2)} / $${CHALLENGE_TARGET}`);
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
    // Load both strategy states
    const [cpStored, epStored] = await Promise.all([
      getRuntimeState("claudeperps").catch(() => ({ found: false })),
      getRuntimeState("emaperps").catch(() => ({ found: false })),
    ]);

    const cpState = cpStored.found ? (cpStored.state || {}) : {};
    const epState = epStored.found ? (epStored.state || {}) : {};

    // Compute metrics
    const cpSig      = computeSignalStats(cpState.signals || []);
    const cpPaper    = computePaperStats(cpState.paper   || {});
    const epSig      = computeSignalStats(epState.signals || []);
    const epPaper    = computePaperStats(epState.paper   || {});
    const epPatterns = patternBreakdown(epState.signals || []);
    const cpTiers    = qualityTierBreakdown(cpState.signals || []);
    const epTiers    = qualityTierBreakdown(epState.signals || []);

    const suggestions = generateSuggestions(cpSig, cpPaper, epSig, epPaper, epPatterns, cpTiers, epTiers);
    const runDate     = new Date().toISOString().slice(0, 10);
    const message     = buildDiscordMessage(cpSig, cpPaper, epSig, epPaper, epPatterns, suggestions, runDate);

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
        claudeperps: {
          signals: { alerted: cpSig.alerted.length, resolved: cpSig.resolved.length, winRate: cpSig.winRate, tp2Rate: cpSig.tp2Rate },
          paper: { balance: cpPaper.balance, totalReturn: cpPaper.totalReturn, winRate: cpPaper.winRate, pf: cpPaper.pf },
        },
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
