"use strict";
/**
 * taperps.js — frontend for the TA Perps multi-confluence scanner.
 */

const API = "/api/taperps-scan";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtPrice(v) {
  if (v == null || !isFinite(v)) return "—";
  return "$" + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function fmtPct(entry, target) {
  if (!entry || !target) return "";
  const p = ((target - entry) / entry * 100).toFixed(2);
  return ` (${p > 0 ? "+" : ""}${p}%)`;
}

function fmtTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function scoreColor(score) {
  if (score >= 85) return "#f59e0b";
  if (score >= 70) return "#a78bfa";
  return "#6366f1";
}

function scoreEmoji(score) {
  if (score >= 85) return "🔥";
  if (score >= 70) return "⚡";
  return "📡";
}

// ── Render signals ────────────────────────────────────────────────────────────

function renderSignals(signals) {
  const container = document.getElementById("ta-signals-list");
  if (!signals || signals.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>No signals yet. Hit <strong>Scan Now</strong> to run a manual scan, or wait for the hourly cron.</p></div>`;
    return;
  }

  const tpl = document.getElementById("ta-signal-tpl");
  container.innerHTML = "";

  // Sort by score descending
  const sorted = [...signals].sort((a, b) => b.score - a.score);

  for (const sig of sorted) {
    const clone = tpl.content.cloneNode(true);
    const card  = clone.querySelector(".signal-card");
    const isBull = sig.side === "long";

    card.dataset.side = sig.side;
    card.style.borderLeftColor = isBull ? "var(--green)" : "var(--red)";

    clone.querySelector(".signal-symbol").textContent    = sig.symbol.replace("USDT", "/USDT");
    const sideBadge = clone.querySelector(".signal-side-badge");
    sideBadge.textContent = sig.side.toUpperCase();
    sideBadge.style.background = isBull ? "rgba(34,197,94,.15)" : "rgba(239,68,68,.15)";
    sideBadge.style.color      = isBull ? "var(--green)" : "var(--red)";
    sideBadge.style.border     = `1px solid ${isBull ? "rgba(34,197,94,.35)" : "rgba(239,68,68,.35)"}`;
    sideBadge.style.borderRadius = "4px";
    sideBadge.style.padding    = "1px 7px";
    sideBadge.style.fontSize   = ".72rem";
    sideBadge.style.fontWeight = "600";

    const scoreBadge = clone.querySelector(".signal-score-badge");
    scoreBadge.textContent = `${scoreEmoji(sig.score)} ${sig.score}/100`;
    scoreBadge.style.color = scoreColor(sig.score);
    scoreBadge.style.fontSize = ".78rem";
    scoreBadge.style.fontWeight = "600";
    scoreBadge.style.marginLeft = ".5rem";

    clone.querySelector(".signal-time").textContent   = fmtTime(sig.detectedAt);
    clone.querySelector(".signal-entry").textContent  = fmtPrice(sig.entry);
    clone.querySelector(".signal-sl").textContent     = fmtPrice(sig.sl)   + fmtPct(sig.entry, sig.sl);
    clone.querySelector(".signal-tp1").textContent    = fmtPrice(sig.tp1)  + fmtPct(sig.entry, sig.tp1);
    clone.querySelector(".signal-tp2").textContent    = fmtPrice(sig.tp2)  + fmtPct(sig.entry, sig.tp2);

    // Confluence bars
    const barsEl = clone.querySelector(".confluence-bars");
    const pillars = sig.pillars || {};
    const rows = [
      { label: "Channel",    score: pillars.channel?.score,    desc: pillars.channel?.desc,    max: 25 },
      { label: "Divergence", score: pillars.divergence?.score, desc: pillars.divergence?.desc, max: 30 },
      { label: "Wave",       score: pillars.wave?.score,       desc: pillars.wave?.desc,       max: 25 },
      { label: "Fibonacci",  score: pillars.fibonacci?.score,  desc: pillars.fibonacci?.desc,  max: 20 },
      { label: "RSI",        score: pillars.rsi?.score,        desc: pillars.rsi?.desc,        max: 5  },
    ];

    for (const row of rows) {
      if ((row.score ?? 0) === 0 && !row.desc) continue;
      const div = document.createElement("div");
      div.className = "confluence-row";
      div.style.cssText = "display:flex;align-items:center;gap:.5rem;margin:.25rem 0;font-size:.75rem;";
      const pct = Math.round(((row.score ?? 0) / row.max) * 100);
      div.innerHTML = `
        <span style="width:72px;color:var(--text-muted);flex-shrink:0;">${row.label}</span>
        <div style="flex:1;height:5px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${(row.score ?? 0) > 0 ? "#a78bfa" : "transparent"};border-radius:3px;transition:width .3s;"></div>
        </div>
        <span style="width:28px;text-align:right;color:${(row.score ?? 0) > 0 ? "#a78bfa" : "var(--text-muted)"};">${row.score ?? 0}</span>
        <span style="color:var(--text-muted);flex:1;">${row.desc ?? ""}</span>
      `;
      barsEl.appendChild(div);
    }

    // Trend row
    if (pillars.trend) {
      const div = document.createElement("div");
      div.style.cssText = "margin:.35rem 0 0;font-size:.73rem;color:var(--text-muted);";
      div.textContent = `Trend: ${pillars.trend.desc}`;
      barsEl.appendChild(div);
    }

    container.appendChild(clone);
  }
}

// ── Update stats row ─────────────────────────────────────────────────────────

function updateStats(signals) {
  if (!signals || signals.length === 0) {
    document.getElementById("ta-stats-row").style.display = "none";
    return;
  }
  document.getElementById("ta-stats-row").style.display = "";
  const longs  = signals.filter(s => s.side === "long").length;
  const shorts = signals.filter(s => s.side === "short").length;
  const avg    = signals.reduce((s, x) => s + x.score, 0) / signals.length;
  document.getElementById("ta-stat-total").textContent  = signals.length;
  document.getElementById("ta-stat-longs").textContent  = longs;
  document.getElementById("ta-stat-shorts").textContent = shorts;
  document.getElementById("ta-stat-avgscore").textContent = avg.toFixed(0);
}

// ── Fetch state ───────────────────────────────────────────────────────────────

async function loadState() {
  const dot = document.getElementById("ta-status-dot");
  const msg = document.getElementById("ta-status-msg");
  const lastScanEl = document.getElementById("ta-last-scan");
  try {
    const r = await fetch(API);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();

    dot.className = "status-dot status-dot--up";
    msg.textContent = data.skipped ? "Scan skipped (cooldown active)" : "Scan complete";
    if (data.lastScan) lastScanEl.textContent = `Last scan: ${fmtTime(data.lastScan)}`;

    renderSignals(data.signals ?? []);
    updateStats(data.signals ?? []);
  } catch (e) {
    dot.className = "status-dot status-dot--down";
    msg.textContent = `Error: ${e.message}`;
  }
}

// ── Manual scan ───────────────────────────────────────────────────────────────

async function triggerScan() {
  const btn = document.getElementById("ta-scan-btn");
  const status = document.getElementById("ta-scan-status");
  const dot = document.getElementById("ta-status-dot");
  const msg = document.getElementById("ta-status-msg");

  btn.disabled = true;
  btn.textContent = "Scanning…";
  status.textContent = "Fetching klines for top 80 symbols…";
  dot.className = "status-dot status-dot--neutral";
  msg.textContent = "Scanning…";

  try {
    const r = await fetch(API + "?manual=1");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();

    const s = data.summary;
    if (s) {
      status.textContent = `Scanned ${s.scanned} symbols · ${s.signals} setups · ${s.alerted} alerted`;
    } else {
      status.textContent = "Done";
    }

    dot.className = "status-dot status-dot--up";
    msg.textContent = `Scan complete — ${(data.signals ?? []).length} signals`;
    renderSignals(data.signals ?? []);
    updateStats(data.signals ?? []);

    if (data.lastScan) {
      document.getElementById("ta-last-scan").textContent = `Last scan: ${fmtTime(data.lastScan)}`;
    }
  } catch (e) {
    status.textContent = `Error: ${e.message}`;
    dot.className = "status-dot status-dot--down";
    msg.textContent = `Scan failed: ${e.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Scan Now";
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("ta-scan-btn").addEventListener("click", triggerScan);
  loadState();
  // Refresh every 5 minutes passively
  setInterval(loadState, 5 * 60 * 1000);
});
