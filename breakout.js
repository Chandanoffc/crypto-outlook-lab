"use strict";

const API = "/api/breakout";
const BINANCE_FAPI = "https://fapi.binance.com/fapi/v1";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v, digits) {
  if (v == null || isNaN(v)) return "—";
  const d = digits ?? (v >= 10000 ? 2 : v >= 100 ? 3 : v >= 1 ? 4 : v >= 0.01 ? 5 : 8);
  return Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtPct(v) {
  if (v == null || isNaN(v)) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
}

function timeAgo(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 60)   return `${Math.round(d)}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

// ── Live prices ───────────────────────────────────────────────────────────────

async function fetchLivePrices(symbols) {
  const prices = {};
  await Promise.allSettled(symbols.map(async sym => {
    try {
      const r = await fetch(`${BINANCE_FAPI}/ticker/price?symbol=${sym}`);
      const d = await r.json();
      if (d?.price) prices[sym] = parseFloat(d.price);
    } catch (_) {}
  }));
  return prices;
}

// ── Render signals ────────────────────────────────────────────────────────────

function renderSignals(signals) {
  const container = document.getElementById("bo-signals-list");
  const tpl       = document.getElementById("bo-signal-tpl");
  if (!container || !tpl) return;

  // Stats
  const statsRow = document.getElementById("bo-stats-row");
  if (signals.length) {
    statsRow.style.display = "";
    document.getElementById("bo-stat-total").textContent     = signals.length;
    const avgScore = signals.reduce((s, x) => s + x.score, 0) / signals.length;
    document.getElementById("bo-stat-avgscore").textContent  = avgScore.toFixed(1);
    const avgDecline = signals.reduce((s, x) => s + (x.declinePct || 0), 0) / signals.length;
    document.getElementById("bo-stat-decline").textContent   = avgDecline.toFixed(1) + "%";
    const avgVol = signals.reduce((s, x) => s + (x.volExpansion || 1), 0) / signals.length;
    document.getElementById("bo-stat-vol").textContent       = avgVol.toFixed(2) + "×";
  } else {
    statsRow.style.display = "none";
  }

  if (!signals.length) {
    container.innerHTML = `<div class="empty-state"><p>No signals yet. Hit <strong>Scan Now</strong> to run a manual scan.</p></div>`;
    return;
  }

  container.innerHTML = "";
  for (const sig of signals) {
    const node  = tpl.content.cloneNode(true);
    const card  = node.querySelector(".signal-card");
    card.querySelector(".signal-symbol").textContent  = sig.symbol?.replace("USDT", "/USDT") ?? "—";
    card.querySelector(".signal-score-badge").textContent = `${sig.score}/100`;
    card.querySelector(".signal-score-badge").style.cssText = `padding:.15rem .45rem;border-radius:4px;font-size:.72rem;font-weight:600;background:rgba(245,158,11,.15);color:#fbbf24;border:1px solid rgba(245,158,11,.3);`;
    card.querySelector(".signal-time").textContent    = sig.detectedAt ? timeAgo(sig.detectedAt) : "";
    card.querySelector(".signal-entry").textContent   = fmt(sig.entry);
    card.querySelector(".signal-sl").textContent      = fmt(sig.sl);
    card.querySelector(".signal-tp1").textContent     = fmt(sig.tp1);
    card.querySelector(".signal-tp2").textContent     = fmt(sig.tp2);
    card.querySelector(".bo-decline").textContent     = (sig.declinePct ?? "—") + "%";
    card.querySelector(".bo-retest").textContent      = (sig.retestAccuracy ?? "—") + "% above cap";
    card.querySelector(".bo-bars").textContent        = (sig.accumulationBars ?? "—") + " bars";
    card.querySelector(".bo-vol").textContent         = (sig.volExpansion ?? "—") + "×";
    const struct = [];
    if (sig.isTight)       struct.push("tight range");
    if (sig.hasRisingLows) struct.push("rising lows");
    card.querySelector(".bo-struct").textContent = struct.join(" · ") || "—";
    container.appendChild(node);
  }
}

// ── Render paper positions ────────────────────────────────────────────────────

async function renderPaper(paper) {
  const section = document.getElementById("bo-paper-section");
  if (!paper) { section.style.display = "none"; return; }
  section.style.display = "";

  const startBal = paper.startingBalance || 100;
  const ret      = ((paper.balance - startBal) / startBal * 100);
  const retColor = ret >= 0 ? "var(--green)" : "var(--red)";

  document.getElementById("bo-paper-balance").textContent = "$" + paper.balance.toFixed(2);
  document.getElementById("bo-paper-return").textContent  = fmtPct(ret);
  document.getElementById("bo-paper-return").style.color  = retColor;
  document.getElementById("bo-paper-open").textContent    = paper.openPositions.length;
  document.getElementById("bo-paper-total").textContent   = paper.closedTrades.length;

  const wins = paper.closedTrades.filter(t => (t.pnl || 0) > 0).length;
  const total = paper.closedTrades.length;
  document.getElementById("bo-paper-winrate").textContent = total ? (wins / total * 100).toFixed(0) + "%" : "—";

  const cbWarn = document.getElementById("bo-cb-warning");
  if (paper.pausedUntil && Date.now() < paper.pausedUntil) {
    cbWarn.style.display = "";
    cbWarn.textContent   = "⚠️ Circuit Breaker: " + paper.pauseReason;
  } else {
    cbWarn.style.display = "none";
  }

  // Live prices for open positions
  let prices = {};
  if (paper.openPositions.length) {
    const syms = [...new Set(paper.openPositions.map(p => p.symbol))];
    prices = await fetchLivePrices(syms);
  }

  renderPositions(paper.openPositions, "bo-open-positions", true, prices);
  renderPositions(paper.closedTrades,  "bo-closed-trades",  false, {});
}

function renderPositions(trades, containerId, isOpen, prices) {
  const container = document.getElementById(containerId);
  const tpl       = document.getElementById("bo-position-tpl");
  if (!container || !tpl) return;

  if (!trades.length) {
    container.innerHTML = `<div class="empty-state" style="padding:.75rem;"><p style="margin:0;font-size:.8rem;">${isOpen ? "No open positions." : "No closed trades yet."}</p></div>`;
    return;
  }

  container.innerHTML = "";
  for (const pos of trades) {
    const node  = tpl.content.cloneNode(true);
    const card  = node.querySelector(".signal-card");

    card.querySelector(".signal-symbol").textContent    = pos.symbol?.replace("USDT", "/USDT") ?? "—";
    card.querySelector(".signal-score-badge").textContent = `${pos.score}/100`;
    card.querySelector(".signal-score-badge").style.cssText = `padding:.15rem .45rem;border-radius:4px;font-size:.72rem;font-weight:600;background:rgba(245,158,11,.15);color:#fbbf24;border:1px solid rgba(245,158,11,.3);`;

    if (isOpen) {
      const markPrice = prices[pos.symbol] || pos.lastMarkPrice;
      const diff      = markPrice ? markPrice - pos.entryPrice : null;
      const lev       = pos.leverage || 3;
      const unrPnl    = diff != null ? (diff / pos.entryPrice) * pos.size * lev : null;
      const pnlPct    = diff != null ? (diff / pos.entryPrice) * lev * 100 : null;
      const isProfit  = (unrPnl ?? 0) >= 0;

      const badge = card.querySelector(".pos-pnl-badge");
      if (unrPnl != null) {
        badge.textContent = (isProfit ? "+" : "") + "$" + unrPnl.toFixed(2) + " (" + (isProfit ? "+" : "") + pnlPct.toFixed(1) + "%)";
        badge.style.cssText = `font-size:.75rem;padding:.2rem .5rem;border-radius:4px;font-weight:600;background:${isProfit ? "rgba(34,197,94,.12)" : "rgba(239,68,68,.12)"};color:${isProfit ? "#4ade80" : "#f87171"};`;
      } else {
        badge.textContent = "Awaiting price…";
        badge.style.cssText = "font-size:.75rem;padding:.2rem .5rem;border-radius:4px;font-weight:600;color:var(--text-muted);";
      }

      card.querySelector(".pos-mark").textContent = markPrice ? fmt(markPrice) : "—";

      // Progress bar: SL → TP2
      const range    = pos.tp2 - pos.sl;
      const progress = markPrice && range > 0 ? Math.max(0, Math.min(100, (markPrice - pos.sl) / range * 100)) : 0;
      const fill = card.querySelector(".pos-progress-fill");
      fill.style.width      = progress + "%";
      fill.style.background = isProfit ? "var(--green)" : "var(--red)";
      card.querySelector(".pos-progress-sl").textContent   = fmt(pos.sl);
      card.querySelector(".pos-progress-mark").textContent = markPrice ? fmt(markPrice) : "—";
      card.querySelector(".pos-progress-tp2").textContent  = fmt(pos.tp2);

      if (pos.slMovedToBE) card.querySelector(".pos-be-tag").style.display   = "";
      if (pos.tp1Reached)  card.querySelector(".pos-tp1-tag").style.display  = "";
    } else {
      // Closed trade
      const isWin = (pos.pnl || 0) >= 0;
      const badge = card.querySelector(".pos-pnl-badge");
      badge.textContent = (isWin ? "+" : "") + "$" + (pos.pnl || 0).toFixed(2) + " (" + (pos.pnlPct || 0).toFixed(1) + "%)";
      badge.style.cssText = `font-size:.75rem;padding:.2rem .5rem;border-radius:4px;font-weight:600;background:${isWin ? "rgba(34,197,94,.12)" : "rgba(239,68,68,.12)"};color:${isWin ? "#4ade80" : "#f87171"};`;
      card.querySelector(".pos-mark").textContent = pos.closedPrice ? fmt(pos.closedPrice) : "—";
      const reason = pos.closeReason || "";
      const reasonEl = document.createElement("span");
      reasonEl.textContent = reason;
      reasonEl.style.cssText = "margin-left:.4rem;padding:.1rem .35rem;border-radius:3px;font-size:.68rem;background:rgba(255,255,255,.06);color:var(--text-muted);";
      card.querySelector(".pos-be-tag").replaceWith(reasonEl);
      card.querySelector(".pos-tp1-tag").remove();
      const fill = card.querySelector(".pos-progress-fill");
      fill.style.width      = "0%";
      fill.style.background = "transparent";
    }

    card.querySelector(".pos-entry").textContent   = fmt(pos.entryPrice);
    card.querySelector(".pos-sl").textContent      = fmt(pos.sl);
    card.querySelector(".pos-tp1").textContent     = fmt(pos.tp1);
    card.querySelector(".pos-tp2").textContent     = fmt(pos.tp2);
    card.querySelector(".pos-size").textContent    = "$" + (pos.size || 0).toFixed(2);
    card.querySelector(".pos-opened").textContent  = pos.openedAt ? timeAgo(pos.openedAt) : (pos.closedAt ? timeAgo(pos.closedAt) : "");

    container.appendChild(node);
  }
}

// ── State load ────────────────────────────────────────────────────────────────

async function loadState() {
  const statusDot = document.getElementById("bo-status-dot");
  const statusMsg = document.getElementById("bo-status-msg");
  const lastScan  = document.getElementById("bo-last-scan");
  try {
    const r = await fetch(API);
    const d = await r.json();
    statusDot.className = "status-dot status-dot--ok";
    statusMsg.textContent = "Connected";
    if (d.lastScan) lastScan.textContent = "Last scan: " + timeAgo(d.lastScan);
    renderSignals(d.signals || []);
    await renderPaper(d.paper);
  } catch (e) {
    statusDot.className = "status-dot status-dot--error";
    statusMsg.textContent = "Failed to load";
    console.error(e);
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────

function initSettings() {
  const overlay = document.getElementById("bo-settings-overlay");
  const form    = document.getElementById("bo-settings-form");
  const webhook = document.getElementById("bo-s-webhook");

  document.getElementById("bo-settings-btn").addEventListener("click", async () => {
    try {
      const r = await fetch(API);
      const d = await r.json();
      if (d?.settings?.discordWebhook) webhook.value = d.settings.discordWebhook;
    } catch (_) {}
    overlay.hidden = false;
    overlay.style.display = "flex";
  });

  const close = () => { overlay.hidden = true; overlay.style.display = "none"; };
  document.getElementById("bo-settings-close").addEventListener("click", close);
  document.getElementById("bo-settings-cancel").addEventListener("click", close);
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "settings", discordWebhook: webhook.value.trim() }),
      });
      close();
    } catch (_) {}
    btn.disabled = false; btn.textContent = "Save";
  });
}

// ── Scan button ───────────────────────────────────────────────────────────────

function initScanBtn() {
  const btn    = document.getElementById("bo-scan-btn");
  const status = document.getElementById("bo-scan-status");

  btn.addEventListener("click", async () => {
    btn.disabled = true; btn.textContent = "Scanning…";
    status.textContent = "Scanning ~150 symbols on daily bars…";
    const start = Date.now();
    try {
      const r = await fetch(API + "?action=scan&manual=1");
      const d = await r.json();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      if (d.skipped) {
        status.textContent = "Skipped (cooldown active). Showing latest state.";
      } else if (d.summary) {
        status.textContent = `Scanned ${d.summary.scanned} · Detected ${d.summary.detected} · Alerted ${d.summary.alerted} · ${elapsed}s`;
      }
      renderSignals(d.signals || []);
      await renderPaper(d.paper);
      document.getElementById("bo-last-scan").textContent = "Last scan: just now";
    } catch (e) {
      status.textContent = "Scan failed: " + e.message;
    }
    btn.disabled = false; btn.textContent = "Scan Now";
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  initSettings();
  initScanBtn();
  loadState();
  setInterval(loadState, 60_000);
});
