"use strict";
/**
 * taperps.js — frontend for the TA Perps multi-confluence scanner.
 */

const API      = "/api/taperps-scan";
const STATE_API = "/api/taperps";

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

// ── Paper trade rendering ─────────────────────────────────────────────────────

function renderPaper(paper) {
  if (!paper) return;
  document.getElementById("ta-paper-section").style.display = "";

  const start = paper.startingBalance || 100;
  const bal   = paper.balance ?? start;
  const ret   = ((bal - start) / start * 100).toFixed(2);
  const retPos = parseFloat(ret) >= 0;

  document.getElementById("ta-paper-balance").textContent = `$${bal.toFixed(2)}`;
  const retEl = document.getElementById("ta-paper-return");
  retEl.textContent = `${retPos ? "+" : ""}${ret}%`;
  retEl.style.color = retPos ? "var(--green)" : "var(--red)";

  document.getElementById("ta-paper-open").textContent = (paper.openPositions || []).length;

  const closed = paper.closedTrades || [];
  document.getElementById("ta-paper-total").textContent = closed.length;
  const wins = closed.filter(t => (t.pnl ?? 0) > 0).length;
  document.getElementById("ta-paper-winrate").textContent = closed.length ? `${Math.round(wins / closed.length * 100)}%` : "—";

  // Circuit breaker warning
  const cbEl = document.getElementById("ta-cb-warning");
  if (paper.pausedUntil && Date.now() < paper.pausedUntil) {
    cbEl.style.display = "";
    cbEl.textContent = `⚠ ${paper.pauseReason || "Circuit breaker active — new entries paused."}`;
  } else {
    cbEl.style.display = "none";
  }

  renderPositions(paper.openPositions || [], "ta-open-positions", true);
  renderPositions((paper.closedTrades || []).slice(0, 30), "ta-closed-trades", false);
}

function renderPositions(trades, containerId, isOpen) {
  const el = document.getElementById(containerId);
  if (!trades.length) {
    el.innerHTML = `<div class="empty-state" style="padding:.75rem;"><p style="margin:0;font-size:.8rem;">${isOpen ? "No open positions." : "No closed trades yet."}</p></div>`;
    return;
  }
  el.innerHTML = trades.map(t => {
    const isLong = t.side === "long";
    const pnl    = t.pnl ?? 0;
    const pnlPct = t.pnlPct ?? 0;
    const pnlPos = pnl >= 0;
    const borderColor = isOpen ? (isLong ? "var(--green)" : "var(--red)") : (pnlPos ? "var(--green)" : "var(--red)");
    const sideLabel = isLong ? "🟢 LONG" : "🔴 SHORT";
    const reasonBadge = t.closeReason ? `<span style="padding:1px 6px;border-radius:4px;font-size:.7rem;font-weight:600;background:rgba(255,255,255,.06);">${t.closeReason}</span>` : "";
    const mark = isOpen && t.lastMarkPrice
      ? `<span style="color:var(--text-muted);font-size:.72rem;">Mark: $${Number(t.lastMarkPrice).toLocaleString(undefined,{maximumFractionDigits:4})}</span>`
      : "";
    const pnlStr = isOpen ? "" : `<span style="color:${pnlPos?"var(--green)":"var(--red)"};font-weight:600;font-size:.8rem;">${pnlPos?"+":""}$${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)</span>`;
    return `
      <div style="padding:.75rem 1rem;border-left:3px solid ${borderColor};background:rgba(255,255,255,.03);border-radius:6px;margin-bottom:.5rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem;">
        <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">
          <strong style="font-size:.85rem;">${t.symbol.replace("USDT","/USDT")}</strong>
          <span style="font-size:.75rem;">${sideLabel}</span>
          ${reasonBadge}
          <span style="font-size:.72rem;color:var(--text-muted);">Score ${t.score ?? "—"}</span>
        </div>
        <div style="display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;font-size:.78rem;">
          <span>Entry: <strong>$${Number(t.entryPrice).toLocaleString(undefined,{maximumFractionDigits:6})}</strong></span>
          ${isOpen ? `<span>SL: <span style="color:var(--red);">$${Number(t.sl).toLocaleString(undefined,{maximumFractionDigits:6})}</span></span>` : ""}
          ${isOpen ? `<span>TP1: <span style="color:var(--green);">$${Number(t.tp1).toLocaleString(undefined,{maximumFractionDigits:6})}</span></span>` : ""}
          ${mark}
          ${pnlStr}
          <span style="color:var(--text-muted);font-size:.7rem;">${fmtTime(isOpen ? t.openedAt : t.closedAt)}</span>
        </div>
      </div>`;
  }).join("");
}

// ── Settings modal ────────────────────────────────────────────────────────────

function initSettings() {
  const overlay = document.getElementById("ta-settings-overlay");
  const close   = () => { overlay.hidden = true; };
  document.getElementById("ta-settings-btn")?.addEventListener("click", () => { overlay.hidden = false; });
  document.getElementById("ta-settings-close")?.addEventListener("click", close);
  document.getElementById("ta-settings-cancel")?.addEventListener("click", close);
  overlay?.addEventListener("click", e => { if (e.target === overlay) close(); });

  document.getElementById("ta-settings-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const webhook = document.getElementById("ta-s-webhook").value.trim();
    const r = await fetch(STATE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "settings", discordWebhook: webhook }),
    });
    const d = await r.json();
    if (d.ok) close();
  });
}

// ── Fetch state ───────────────────────────────────────────────────────────────

async function loadState() {
  const dot = document.getElementById("ta-status-dot");
  const msg = document.getElementById("ta-status-msg");
  const lastScanEl = document.getElementById("ta-last-scan");
  try {
    const r = await fetch(STATE_API);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();

    dot.className = "status-dot status-dot--up";
    msg.textContent = "Ready";
    if (data.lastScan) lastScanEl.textContent = `Last scan: ${fmtTime(data.lastScan)}`;

    // Populate settings form with saved webhook
    const webhookEl = document.getElementById("ta-s-webhook");
    if (webhookEl && data.settings?.discordWebhook) webhookEl.value = data.settings.discordWebhook;

    renderSignals(data.signals ?? []);
    updateStats(data.signals ?? []);
    if (data.paper) renderPaper(data.paper);
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
    if (data.paper) renderPaper(data.paper);

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
  initSettings();
  loadState();
  setInterval(loadState, 5 * 60 * 1000);
});
