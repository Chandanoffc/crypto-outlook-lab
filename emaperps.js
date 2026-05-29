"use strict";
// EMA Perps frontend — EMA Signals Strategy

// ─── State ───────────────────────────────────────────────────────────────────
let state = {
  signals: [], lastScanAt: 0,
  alertDelivery: { discordWebhook: "", notifyOnNew: true },
  paper: { balance: 100, startingBalance: 100, openPositions: [], closedTrades: [], lastMarkAt: 0 },
  lastScanResults: [],
};
let currentTab  = "active";
let currentPage = "signals";
let activeChart = null;
let pollTimer   = null;
const POLL_INTERVAL_MS = 30_000;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const dom = {
  statusDot:      document.getElementById("ep-status-dot"),
  statusMsg:      document.getElementById("ep-status-msg"),
  lastScan:       document.getElementById("ep-last-scan"),
  searchInput:    document.getElementById("ep-search-input"),
  searchBtn:      document.getElementById("ep-search-btn"),
  scanBtn:        document.getElementById("ep-scan-btn"),
  searchResult:   document.getElementById("ep-search-result"),
  signalFeed:     document.getElementById("ep-signal-feed"),
  chartContainer: document.getElementById("ep-chart-container"),
  chartSymbol:    document.getElementById("ep-chart-symbol"),
  chartLevels:    document.getElementById("ep-chart-levels"),
  discordInput:   document.getElementById("ep-discord-input"),
  discordNotify:  document.getElementById("ep-discord-notify"),
  discordSave:    document.getElementById("ep-discord-save"),
  discordNote:    document.getElementById("ep-discord-note"),
  metricActive:   document.getElementById("ep-metric-active"),
  metricStrong:   document.getElementById("ep-metric-strong"),
  metricLongs:    document.getElementById("ep-metric-longs"),
  metricShorts:   document.getElementById("ep-metric-shorts"),
  metricAvgQ:     document.getElementById("ep-metric-avgq"),
  metricScan:     document.getElementById("ep-metric-scan"),
  // Page tabs
  pageSections: {
    signals: document.getElementById("ep-page-signals"),
    scanner: document.getElementById("ep-page-scanner"),
    paper:   document.getElementById("ep-page-paper"),
    test:    document.getElementById("ep-page-test"),
  },
  // Test alerts
  testWebhook: document.getElementById("ep-test-webhook"),
  testResult:  document.getElementById("ep-test-result"),
  // Scanner
  scannerFeed:  document.getElementById("ep-scanner-feed"),
  scannerTitle: document.getElementById("ep-scanner-title"),
  scannerMeta:  document.getElementById("ep-scanner-meta"),
  // Paper
  paperBalance:     document.getElementById("ep-paper-balance"),
  paperStarting:    document.getElementById("ep-paper-starting"),
  paperPnl:         document.getElementById("ep-paper-pnl"),
  paperWinrate:     document.getElementById("ep-paper-winrate"),
  paperOpenCount:   document.getElementById("ep-paper-open-count"),
  paperClosedCount: document.getElementById("ep-paper-closed-count"),
  paperOpen:        document.getElementById("ep-paper-open"),
  paperClosed:      document.getElementById("ep-paper-closed"),
  paperReset:       document.getElementById("ep-paper-reset"),
  // Comparison
  comparison:   document.getElementById("ep-comparison"),
  compareMeta:  document.getElementById("ep-compare-meta"),
};

// ─── Formatters ──────────────────────────────────────────────────────────────
function fp(v, prec = 2) {
  if (v == null || !isFinite(v)) return "–";
  return "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: prec >= 4 ? 6 : 2 });
}

function fPct(v, digits = 2) {
  if (v == null || !isFinite(v)) return "–";
  return (v >= 0 ? "+" : "") + Number(v).toFixed(digits) + "%";
}

function timeAgo(ts) {
  if (!ts) return "";
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function qualityClass(q) {
  if (q >= 80) return "quality-high";
  if (q >= 70) return "quality-good";
  return "quality-ok";
}

function qualityLabel(q) {
  if (q >= 80) return "Strong Signal";
  if (q >= 70) return "Good Signal";
  return "Valid Signal";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
/** Normalise S/R levels from either flat signal fields or nested levels object */
function sigLevels(signal) {
  if (!signal) return {};
  return signal.levels || { s1: signal.s1, s2: signal.s2, r1: signal.r1, r2: signal.r2 };
}

// ─── Page tabs ───────────────────────────────────────────────────────────────
function switchPage(page) {
  currentPage = page;
  Object.entries(dom.pageSections).forEach(([key, el]) => {
    if (el) el.hidden = key !== page;
  });
  document.querySelectorAll("[data-ep-page]").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.epPage === page);
  });
  if (page === "scanner") renderScannerTab();
  if (page === "paper")   { renderPaperTab(); loadComparison(); }
  if (page === "test")    initTestTab();
}

// ─── Metrics ─────────────────────────────────────────────────────────────────
function renderMetrics() {
  const active = state.signals.filter(s => s.status === "active");
  const strong = active.filter(s => s.quality >= 80);
  const longs  = active.filter(s => s.side === "Long").length;
  const shorts = active.filter(s => s.side === "Short").length;
  const avgQ   = active.length
    ? Math.round(active.reduce((a, s) => a + s.quality, 0) / active.length)
    : null;

  dom.metricActive.textContent = active.length || "–";
  dom.metricStrong.textContent = strong.length || "–";
  dom.metricLongs.textContent  = longs  || "–";
  dom.metricShorts.textContent = shorts || "–";
  dom.metricAvgQ.textContent   = avgQ != null ? `Q${avgQ}` : "–";
  if (state.lastScanAt) dom.metricScan.textContent = timeAgo(state.lastScanAt);
}

// ─── Signal feed ─────────────────────────────────────────────────────────────
function renderSignalCard(signal) {
  const isLong = signal.side === "Long";
  const dir    = isLong ? "long" : "short";
  const prec   = signal.pricePrecision || 2;
  const lvls   = sigLevels(signal);
  const reason = signal.signalLabel || signal.reasonLabels?.[0] || "";

  return `
    <article class="signal-card signal-card--${dir}" data-symbol="${signal.symbol}" data-signal-id="${signal.id}" role="button" tabindex="0">
      <div class="sc-inner">
        <div class="sc-head">
          <div class="sc-symbol">
            <span class="sc-symbol-name">${signal.symbol}</span>
            <span class="sc-side">${signal.side.toUpperCase()}</span>
            <span class="sc-interval">${signal.interval || "1h"}</span>
          </div>
          <div class="sc-quality ${qualityClass(signal.quality)}">
            <span class="quality-score">Q${signal.quality}</span>
            <span class="quality-label">${qualityLabel(signal.quality)}</span>
          </div>
        </div>

        <div class="sc-levels">
          <div class="level-row">
            <span class="level-label">Entry</span>
            <span class="level-value">${fp(signal.entryPrice, prec)}</span>
            <span class="level-meta">${reason}</span>
          </div>
          <div class="level-row">
            <span class="level-label">SL</span>
            <span class="level-value tone-down">${fp(signal.sl, prec)}</span>
          </div>
          <div class="level-row">
            <span class="level-label">TP1</span>
            <span class="level-value tone-up">${fp(signal.tp1, prec)}</span>
            <span class="level-meta">${isLong ? "→ R1" : "→ S1"}</span>
          </div>
          <div class="level-row">
            <span class="level-label">TP2</span>
            <span class="level-value tone-up">${fp(signal.tp2, prec)}</span>
            <span class="level-meta">${isLong ? "→ R2" : "→ S2"}</span>
          </div>
        </div>

        ${(lvls.s1 || lvls.r1) ? `
        <div class="sc-sr">
          ${lvls.s2 != null ? `<span class="sr-chip sr-s">S2 ${fp(lvls.s2, prec)}</span>` : ""}
          ${lvls.s1 != null ? `<span class="sr-chip sr-s">S1 ${fp(lvls.s1, prec)}</span>` : ""}
          ${lvls.r1 != null ? `<span class="sr-chip sr-r">R1 ${fp(lvls.r1, prec)}</span>` : ""}
          ${lvls.r2 != null ? `<span class="sr-chip sr-r">R2 ${fp(lvls.r2, prec)}</span>` : ""}
        </div>` : ""}

        <div class="sc-footer">
          <span class="sc-reasons">${(signal.reasonLabels || []).slice(0,3).join(" · ")}</span>
          <span class="sc-time">${timeAgo(signal.detectedAt)}</span>
        </div>
      </div>
    </article>`;
}

function renderFeed() {
  const now = Date.now();
  let filtered = state.signals;
  if (currentTab === "active") {
    filtered = state.signals.filter(s => s.status === "active");
  } else if (currentTab === "strong") {
    filtered = state.signals.filter(s => s.status === "active" && s.quality >= 80);
  } else if (currentTab === "all") {
    filtered = state.signals.filter(s => now - s.detectedAt < 86_400_000);
  }

  if (!filtered.length) {
    const msgs = {
      active: "No active signals right now. Scanner runs every 5 min.",
      strong: "No strong signals (Q80+) active right now.",
      all:    "No signals in the last 24 hours.",
    };
    dom.signalFeed.innerHTML = `<div class="feed-empty"><p>${msgs[currentTab] || "No signals."}</p></div>`;
    return;
  }
  dom.signalFeed.innerHTML = filtered.map(renderSignalCard).join("");

  dom.signalFeed.querySelectorAll(".signal-card").forEach(card => {
    const open = () => {
      const signal = state.signals.find(s => s.id === card.dataset.signalId);
      if (signal) openChartForSignal(signal);
    };
    card.addEventListener("click", open);
    card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") open(); });
  });
}

// ─── Scanner tab ─────────────────────────────────────────────────────────────
function renderScannerCard(signal) {
  const isLong = signal.side === "Long";
  const dir    = isLong ? "long" : "short";
  const prec   = signal.pricePrecision || 2;
  const lvls   = sigLevels(signal);

  return `
    <div class="scanner-card scanner-card--${dir}">
      <div class="scanner-card-head">
        <span class="scanner-symbol">${signal.symbol}</span>
        <span class="scanner-side scanner-side--${dir}">${signal.side}</span>
      </div>
      <div class="scanner-quality">Q${signal.quality} · ${signal.signalLabel || qualityLabel(signal.quality)}</div>
      <div class="scanner-levels">
        <div class="scanner-level-row"><span>Entry</span><span>${fp(signal.entryPrice, prec)}</span></div>
        <div class="scanner-level-row"><span>TP1</span><span class="tone-up">${fp(signal.tp1, prec)}</span></div>
        <div class="scanner-level-row"><span>TP2</span><span class="tone-up">${fp(signal.tp2, prec)}</span></div>
        <div class="scanner-level-row"><span>SL</span><span class="tone-down">${fp(signal.sl, prec)}</span></div>
      </div>
      ${(lvls.s1 || lvls.r1) ? `
      <div class="scanner-reasons">
        ${lvls.s2 != null ? `<span class="scanner-reason-chip sr-s">S2 ${fp(lvls.s2, prec)}</span>` : ""}
        ${lvls.s1 != null ? `<span class="scanner-reason-chip sr-s">S1 ${fp(lvls.s1, prec)}</span>` : ""}
        ${lvls.r1 != null ? `<span class="scanner-reason-chip sr-r">R1 ${fp(lvls.r1, prec)}</span>` : ""}
        ${lvls.r2 != null ? `<span class="scanner-reason-chip sr-r">R2 ${fp(lvls.r2, prec)}</span>` : ""}
      </div>` : ""}
    </div>`;
}

function renderScannerTab() {
  const results = state.lastScanResults || [];
  if (!dom.scannerFeed) return;
  if (!results.length) {
    dom.scannerFeed.innerHTML = `<div class="scanner-empty">No scan results yet. Click "Run Scanner" to scan all tokens.</div>`;
    if (dom.scannerTitle) dom.scannerTitle.textContent = "Scanner results";
    if (dom.scannerMeta)  dom.scannerMeta.textContent  = "Run scanner to see all matching tokens";
    return;
  }
  const longs  = results.filter(s => s.side === "Long");
  const shorts = results.filter(s => s.side === "Short");
  const sorted = [...longs, ...shorts].sort((a, b) => b.quality - a.quality);
  if (dom.scannerTitle) dom.scannerTitle.textContent = `${results.length} token${results.length !== 1 ? "s" : ""} matched`;
  if (dom.scannerMeta)  dom.scannerMeta.textContent  = `${longs.length} longs · ${shorts.length} shorts · Last scan: ${timeAgo(state.lastScanAt)}`;
  dom.scannerFeed.innerHTML = sorted.map(renderScannerCard).join("");
}

// ─── Paper trading tab ───────────────────────────────────────────────────────
function fmt$(v) {
  if (v == null || !isFinite(v)) return "–";
  const n = Number(v);
  return (n >= 0 ? "$" : "-$") + Math.abs(n).toFixed(2);
}

function renderPaperPositionCard(pos, isClosed = false) {
  const isLong  = pos.side === "Long";
  const dir     = isLong ? "long" : "short";
  const prec    = pos.pricePrecision || 2;
  const pnl     = pos.pnl;

  let cardClass = `paper-pos-card paper-pos-card--${dir}`;
  let reasonHtml = "";

  if (isClosed) {
    const reason = pos.closeReason || "";
    if (reason === "TP2" || reason === "TP1") cardClass = "paper-pos-card paper-pos-card--win";
    else if (reason === "SL") cardClass = "paper-pos-card paper-pos-card--loss";
    else cardClass = "paper-pos-card paper-pos-card--expired";

    const reasonClass = reason === "TP2" ? "tp2" : reason === "TP1" ? "tp1" : reason === "SL" ? "sl" : "exp";
    reasonHtml = `<span class="paper-pos-reason paper-pos-reason--${reasonClass}">${reason || "CLOSED"}</span>`;
  }

  const pnlClass = pnl == null ? "paper-pos-pnl--zero" : pnl > 0 ? "paper-pos-pnl--pos" : pnl < 0 ? "paper-pos-pnl--neg" : "paper-pos-pnl--zero";
  const pnlStr   = pnl != null ? `${pnl >= 0 ? "+" : ""}${fmt$(pnl)} (${fPct(pos.pnlPct)})` : "live";
  const tp1Badge = pos.tp1Reached && !isClosed ? `<span class="paper-pos-tp1-badge">TP1 ✓ SL→BE</span>` : "";

  return `
    <div class="${cardClass}">
      <div class="paper-pos-head">
        <span class="paper-pos-symbol">${pos.symbol}</span>
        <span class="paper-pos-side paper-pos-side--${dir}">${pos.side}</span>
        <span class="paper-pos-pnl ${pnlClass}">${pnlStr}</span>
        ${reasonHtml}
      </div>
      ${tp1Badge}
      <div class="paper-pos-meta">
        <span>Entry ${fp(pos.entryPrice, prec)} · Size ${fmt$(pos.size)} · Q${pos.quality}</span>
        <span>${isClosed ? timeAgo(pos.closedAt) : "Opened " + timeAgo(pos.openedAt)}</span>
      </div>
      <div class="paper-pos-meta">
        <span>TP1 ${fp(pos.tp1, prec)} · TP2 ${fp(pos.tp2, prec)} · SL ${fp(pos.sl, prec)}</span>
        ${isClosed && pos.closedPrice ? `<span>Close ${fp(pos.closedPrice, prec)}</span>` : ""}
      </div>
    </div>`;
}

function renderPaperTab() {
  const paper   = state.paper || {};
  const balance = paper.balance ?? 100;
  const starting = paper.startingBalance ?? 100;
  const openPos = paper.openPositions || [];
  const closed  = paper.closedTrades  || [];

  const totalPnl = balance - starting;
  const wins     = closed.filter(t => t.pnl != null && t.pnl > 0).length;
  const winrate  = closed.length ? Math.round((wins / closed.length) * 100) : null;

  if (dom.paperBalance)     dom.paperBalance.textContent     = fmt$(balance);
  if (dom.paperStarting)    dom.paperStarting.textContent    = fmt$(starting);
  if (dom.paperPnl) {
    dom.paperPnl.textContent = (totalPnl >= 0 ? "+" : "") + fmt$(totalPnl);
    dom.paperPnl.className = `stat-value ${totalPnl > 0 ? "tone-up" : totalPnl < 0 ? "tone-down" : ""}`;
  }
  if (dom.paperWinrate)     dom.paperWinrate.textContent     = winrate != null ? `${winrate}%` : "–";
  if (dom.paperOpenCount)   dom.paperOpenCount.textContent   = openPos.length;
  if (dom.paperClosedCount) dom.paperClosedCount.textContent = closed.length;

  if (dom.paperOpen) {
    dom.paperOpen.innerHTML = openPos.length
      ? openPos.map(p => renderPaperPositionCard(p, false)).join("")
      : `<div class="paper-empty">No open positions. Trades open automatically when signals fire.</div>`;
  }

  if (dom.paperClosed) {
    dom.paperClosed.innerHTML = closed.length
      ? closed.slice(0, 50).map(p => renderPaperPositionCard(p, true)).join("")
      : `<div class="paper-empty">No closed trades yet.</div>`;
  }
}

// ─── 24H Comparison ──────────────────────────────────────────────────────────
async function loadComparison() {
  if (!dom.comparison) return;
  dom.comparison.innerHTML = `<div class="compare-loading">Loading comparison data…</div>`;
  if (dom.compareMeta) dom.compareMeta.textContent = "Fetching both strategies…";

  try {
    const [cpRes, epRes] = await Promise.all([
      fetch("/api/claudeperps").then(r => r.json()),
      fetch("/api/emaperps").then(r => r.json()),
    ]);

    const cpPaper = cpRes.state?.paper || {};
    const epPaper = epRes.state?.paper || {};

    function stratStats(paper) {
      const balance  = paper.balance ?? 100;
      const starting = paper.startingBalance ?? 100;
      const closed   = paper.closedTrades || [];
      const open     = paper.openPositions || [];
      const pnl      = balance - starting;
      const pnlPct   = starting > 0 ? ((balance - starting) / starting) * 100 : 0;
      const wins     = closed.filter(t => t.pnl != null && t.pnl > 0).length;
      const losses   = closed.filter(t => t.pnl != null && t.pnl <= 0).length;
      const winrate  = closed.length ? Math.round((wins / closed.length) * 100) : null;
      const avgPnl   = closed.length && closed.some(t => t.pnl != null)
        ? closed.reduce((s, t) => s + (t.pnl ?? 0), 0) / closed.length
        : null;
      return { balance, starting, pnl, pnlPct, wins, losses, winrate, avgPnl, totalTrades: closed.length, openCount: open.length };
    }

    const cp = stratStats(cpPaper);
    const ep = stratStats(epPaper);

    const cpWinner = cp.pnlPct > ep.pnlPct;
    const epWinner = ep.pnlPct > cp.pnlPct;
    const tie      = cp.pnlPct === ep.pnlPct;

    const fmtPnl = (v) => v == null ? "–" : (v >= 0 ? "+" : "") + fmt$(v);
    const fmtPct = (v) => (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
    const fmtWr  = (v) => v != null ? `${v}%` : "–";
    const fmtAvg = (v) => v == null ? "–" : (v >= 0 ? "+" : "") + fmt$(v);

    let bannerText, bannerClass;
    if (tie) {
      bannerText = "🤝 Tied — both strategies are performing equally";
      bannerClass = "compare-winner-banner--tie";
    } else if (cpWinner) {
      bannerText = `🏆 Claudeperps is leading with ${fmtPct(cp.pnlPct - ep.pnlPct)} more return`;
      bannerClass = "compare-winner-banner--claude";
    } else {
      bannerText = `🏆 EMA Perps is leading with ${fmtPct(ep.pnlPct - cp.pnlPct)} more return`;
      bannerClass = "compare-winner-banner--ema";
    }

    dom.comparison.innerHTML = `
      <div class="compare-card">
        <div class="compare-card-title">
          <span class="compare-badge compare-badge--claude">Claudeperps</span>
          ${cpWinner ? `<span class="compare-badge compare-badge--winner">Leading</span>` : ""}
        </div>
        <div class="compare-rows">
          <div class="compare-row"><span class="compare-row-label">Balance</span><span class="compare-row-value">${fmt$(cp.balance)}</span></div>
          <div class="compare-row"><span class="compare-row-label">Total P&L</span><span class="compare-row-value ${cp.pnl >= 0 ? "compare-row-value--pos" : "compare-row-value--neg"}">${fmtPnl(cp.pnl)} (${fmtPct(cp.pnlPct)})</span></div>
          <div class="compare-row"><span class="compare-row-label">Win Rate</span><span class="compare-row-value">${fmtWr(cp.winrate)}</span></div>
          <div class="compare-row"><span class="compare-row-label">Trades</span><span class="compare-row-value">${cp.totalTrades} closed · ${cp.openCount} open</span></div>
          <div class="compare-row"><span class="compare-row-label">Avg Trade</span><span class="compare-row-value ${cp.avgPnl != null && cp.avgPnl >= 0 ? "compare-row-value--pos" : "compare-row-value--neg"}">${fmtAvg(cp.avgPnl)}</span></div>
          <div class="compare-row"><span class="compare-row-label">W / L</span><span class="compare-row-value">${cp.wins} / ${cp.losses}</span></div>
        </div>
      </div>

      <div class="compare-card">
        <div class="compare-card-title">
          <span class="compare-badge compare-badge--ema">EMA Perps</span>
          ${epWinner ? `<span class="compare-badge compare-badge--winner">Leading</span>` : ""}
        </div>
        <div class="compare-rows">
          <div class="compare-row"><span class="compare-row-label">Balance</span><span class="compare-row-value">${fmt$(ep.balance)}</span></div>
          <div class="compare-row"><span class="compare-row-label">Total P&L</span><span class="compare-row-value ${ep.pnl >= 0 ? "compare-row-value--pos" : "compare-row-value--neg"}">${fmtPnl(ep.pnl)} (${fmtPct(ep.pnlPct)})</span></div>
          <div class="compare-row"><span class="compare-row-label">Win Rate</span><span class="compare-row-value">${fmtWr(ep.winrate)}</span></div>
          <div class="compare-row"><span class="compare-row-label">Trades</span><span class="compare-row-value">${ep.totalTrades} closed · ${ep.openCount} open</span></div>
          <div class="compare-row"><span class="compare-row-label">Avg Trade</span><span class="compare-row-value ${ep.avgPnl != null && ep.avgPnl >= 0 ? "compare-row-value--pos" : "compare-row-value--neg"}">${fmtAvg(ep.avgPnl)}</span></div>
          <div class="compare-row"><span class="compare-row-label">W / L</span><span class="compare-row-value">${ep.wins} / ${ep.losses}</span></div>
        </div>
      </div>

      <div class="compare-winner-banner ${bannerClass}">${bannerText}</div>`;

    if (dom.compareMeta) dom.compareMeta.textContent = `Updated: ${timeAgo(Date.now())}`;
  } catch (err) {
    if (dom.comparison) dom.comparison.innerHTML = `<div class="compare-loading">Failed to load comparison: ${err.message}</div>`;
  }
}

// ─── Status ──────────────────────────────────────────────────────────────────
function setStatus(msg, tone = "neutral") {
  dom.statusMsg.textContent = msg;
  dom.statusDot.className = `status-dot status-dot--${tone}`;
}

function updateLastScanLabel() {
  if (state.lastScanAt) {
    dom.lastScan.textContent = `Last scan: ${timeAgo(state.lastScanAt)}`;
  }
}

// ─── Chart rendering ─────────────────────────────────────────────────────────
function destroyChart() {
  if (activeChart) {
    try { activeChart.remove(); } catch (_) {}
    activeChart = null;
  }
  dom.chartContainer.innerHTML = "";
  dom.chartLevels.innerHTML = "";
}

function renderChart(data, signal) {
  destroyChart();
  if (!data?.candles?.length) {
    dom.chartContainer.innerHTML = '<p class="chart-empty">No chart data available.</p>';
    return;
  }

  const container = dom.chartContainer;
  container.style.height = "280px";

  try {
    const chart = LightweightCharts.createChart(container, {
      height: 280,
      layout: { background: { color: "transparent" }, textColor: "#8a8aaa" },
      grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.2 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    });

    const candles = chart.addCandlestickSeries({
      upColor: "#22c55e", downColor: "#ef4444",
      borderUpColor: "#22c55e", borderDownColor: "#ef4444",
      wickUpColor: "#22c55e", wickDownColor: "#ef4444",
    });
    candles.setData(data.candles);

    if (data.ema20Series?.length > 1) {
      const l = chart.addLineSeries({ color: "#38bdf8", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
      l.setData(data.ema20Series);
    }

    if (data.ema50Series?.length > 1) {
      const l = chart.addLineSeries({ color: "#a78bfa", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
      l.setData(data.ema50Series);
    }

    const lvls = sigLevels(signal) || data?.levels || {};
    const addSRLine = (price, color, title) => {
      if (!price || !isFinite(price)) return;
      candles.createPriceLine({ price, color, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: true, title });
    };
    addSRLine(lvls.s1, "#f59e0b", "S1");
    addSRLine(lvls.s2, "#ef4444", "S2");
    addSRLine(lvls.r1, "#34d399", "R1");
    addSRLine(lvls.r2, "#22c55e", "R2");

    if (signal) {
      const addLine = (price, color, title) => {
        if (!price || !isFinite(price)) return;
        candles.createPriceLine({ price, color, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title });
      };
      addLine(signal.entryPrice, "#94a3b8", "Entry");
      addLine(signal.tp1, "#22c55e", "TP1");
      addLine(signal.tp2, "#4ade80", "TP2");
      addLine(signal.sl, "#ef4444", "SL");
    }

    chart.timeScale().fitContent();
    activeChart = chart;

    renderLevelsRow(signal, data);
  } catch (err) {
    container.innerHTML = `<p class="chart-empty">Chart error: ${err.message}</p>`;
  }
}

function renderLevelsRow(signal, data) {
  const prec  = signal?.pricePrecision || data?.pricePrecision || 2;
  const price = data?.currentPrice || signal?.entryPrice;
  const lvls  = sigLevels(signal) || data?.levels || {};

  dom.chartLevels.innerHTML = `
    <div class="levels-row">
      <span class="level-chip">Price <strong>${fp(price, prec)}</strong></span>
      <span class="level-chip tone-cyan">EMA20 <strong>${fp(data?.ema20, prec)}</strong></span>
      <span class="level-chip tone-violet">EMA50 <strong>${fp(data?.ema50, prec)}</strong></span>
      ${lvls.s2 != null ? `<span class="level-chip sr-s">S2 <strong>${fp(lvls.s2, prec)}</strong></span>` : ""}
      ${lvls.s1 != null ? `<span class="level-chip sr-s">S1 <strong>${fp(lvls.s1, prec)}</strong></span>` : ""}
      ${lvls.r1 != null ? `<span class="level-chip sr-r">R1 <strong>${fp(lvls.r1, prec)}</strong></span>` : ""}
      ${lvls.r2 != null ? `<span class="level-chip sr-r">R2 <strong>${fp(lvls.r2, prec)}</strong></span>` : ""}
    </div>`;
}

async function openChartForSignal(signal) {
  dom.chartSymbol.textContent = `${signal.symbol} · ${signal.side} · Q${signal.quality}`;
  dom.chartContainer.innerHTML = '<p class="chart-empty">Loading chart…</p>';
  dom.chartLevels.innerHTML = "";
  try {
    const res = await fetch("/api/emaperps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "analyze", token: signal.symbol }),
    });
    const data = await res.json();
    if (data.ok) renderChart(data, signal);
    else dom.chartContainer.innerHTML = `<p class="chart-empty">${data.error || "Failed to load chart."}</p>`;
  } catch (err) {
    dom.chartContainer.innerHTML = `<p class="chart-empty">Chart failed: ${err.message}</p>`;
  }
}

// ─── Token search / analysis ─────────────────────────────────────────────────
function renderAnalysisResult(data) {
  if (!data.ok) {
    dom.searchResult.innerHTML = `<div class="analysis-error">${data.error || "Analysis failed."}</div>`;
    return;
  }

  const prec   = data.pricePrecision || 2;
  const isUp   = data.trend === "up";
  const trendClass = isUp ? "tone-up" : "tone-down";
  const trendLabel = isUp ? "▲ Uptrend" : "▼ Downtrend";
  const signal = data.signal;
  const lvls   = data.levels || sigLevels(signal);

  const qualChip = signal
    ? `<span class="analysis-quality ${qualityClass(signal.quality)}">Q${signal.quality} · ${qualityLabel(signal.quality)}</span>`
    : `<span class="analysis-quality quality-none">No signal</span>`;

  dom.searchResult.innerHTML = `
    <div class="analysis-card">
      <div class="analysis-hd">
        <div class="analysis-symbol-row">
          <strong>${data.symbol}</strong>
          <span class="${trendClass}" style="font-size:13px;font-weight:600">${trendLabel}</span>
          ${qualChip}
        </div>
        <div class="analysis-price">${fp(data.currentPrice, prec)}</div>
      </div>
      <div class="analysis-inds">
        <div class="analysis-ind"><span>EMA20</span><strong class="tone-cyan">${fp(data.ema20, prec)}</strong></div>
        <div class="analysis-ind"><span>EMA50</span><strong class="tone-violet">${fp(data.ema50, prec)}</strong></div>
        <div class="analysis-ind"><span>Support 1</span><strong class="tone-s1">${fp(lvls?.s1, prec)}</strong></div>
        <div class="analysis-ind"><span>Resistance 1</span><strong class="tone-r1">${fp(lvls?.r1, prec)}</strong></div>
        <div class="analysis-ind"><span>Support 2</span><strong class="tone-s2">${fp(lvls?.s2, prec)}</strong></div>
        <div class="analysis-ind"><span>Resistance 2</span><strong class="tone-r2">${fp(lvls?.r2, prec)}</strong></div>
        <div class="analysis-ind"><span>RSI (14)</span><strong>${data.rsi ? Number(data.rsi).toFixed(1) : "–"}</strong></div>
        <div class="analysis-ind"><span>ATR</span><strong>${fp(data.atr, prec)}</strong></div>
        <div class="analysis-ind"><span>24H Change</span><strong class="${data.change24h >= 0 ? "tone-up" : "tone-down"}">${fPct(data.change24h)}</strong></div>
        <div class="analysis-ind"><span>Volume 24H</span><strong>$${data.volume24h ? (data.volume24h / 1_000_000).toFixed(0) + "M" : "–"}</strong></div>
      </div>
      ${signal ? `
        <div class="analysis-signal">
          <div class="analysis-signal-title">${signal.side} · ${signal.signalLabel || signal.reasonLabels?.[0] || ""}</div>
          <div class="analysis-levels">
            <span class="level-chip-sm">Entry ${fp(signal.entryPrice, prec)}</span>
            <span class="level-chip-sm tp">TP1 ${fp(signal.tp1, prec)} <small>${isUp ? "R1" : "S1"}</small></span>
            <span class="level-chip-sm tp">TP2 ${fp(signal.tp2, prec)} <small>${isUp ? "R2" : "S2"}</small></span>
            <span class="level-chip-sm sl">SL ${fp(signal.sl, prec)}</span>
          </div>
        </div>` : `
        <div class="analysis-note">
          ${isUp
            ? "Uptrend confirmed. Watching for pullback to EMA20/EMA50 or S1/S2 for a Long entry."
            : "Downtrend confirmed. Watching for bounce to EMA20/EMA50 or R1/R2 for a Short entry."}
        </div>`}
    </div>`;

  dom.chartSymbol.textContent = `${data.symbol} · EMA Analysis`;
  renderChart(data, signal || null);
}

async function doSearch() {
  const token = dom.searchInput.value.trim();
  if (!token) return;
  dom.searchResult.innerHTML = `<div class="search-loading">Analyzing ${token.toUpperCase()}…</div>`;
  dom.chartContainer.innerHTML = '<p class="chart-empty">Loading chart…</p>';
  try {
    const res = await fetch("/api/emaperps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "analyze", token }),
    });
    const data = await res.json();
    renderAnalysisResult(data);
  } catch (err) {
    dom.searchResult.innerHTML = `<div class="analysis-error">Request failed: ${err.message}</div>`;
  }
}

// ─── API interactions ────────────────────────────────────────────────────────
async function fetchState() {
  const res = await fetch("/api/emaperps");
  const data = await res.json();
  if (data.ok && data.state) {
    state = data.state;
    renderMetrics();
    renderFeed();
    updateLastScanLabel();
    setStatus(state.lastStatusMessage || "Ready.", state.lastStatusTone || "neutral");
    if (state.alertDelivery?.discordWebhook) {
      dom.discordInput.value    = state.alertDelivery.discordWebhook;
      dom.discordNotify.checked = state.alertDelivery.notifyOnNew !== false;
    }
    if (currentPage === "scanner") renderScannerTab();
    if (currentPage === "paper")   renderPaperTab();
  }
}

async function triggerScan() {
  dom.scanBtn.disabled = true;
  dom.scanBtn.textContent = "Scanning…";
  setStatus("Running scanner…", "neutral");
  try {
    const res = await fetch("/api/emaperps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "scan" }),
    });
    const data = await res.json();
    if (data.state) {
      state = data.state;
      renderMetrics();
      renderFeed();
      updateLastScanLabel();
    }
    setStatus(
      data.summary?.newSignals > 0
        ? `Found ${data.summary.newSignals} new signal${data.summary.newSignals > 1 ? "s" : ""}!`
        : `Scan complete — ${data.summary?.activeCount ?? 0} active signals.`,
      data.summary?.newSignals > 0 ? "up" : "neutral"
    );
    // Auto-switch to scanner tab + refresh it
    switchPage("scanner");
  } catch (err) {
    setStatus(`Scan failed: ${err.message}`, "down");
  } finally {
    dom.scanBtn.disabled = false;
    dom.scanBtn.textContent = "Run Scanner";
  }
}

async function saveDiscord() {
  const webhook     = dom.discordInput.value.trim();
  const notifyOnNew = dom.discordNotify.checked;
  dom.discordNote.textContent = "Saving…";
  try {
    const res = await fetch("/api/emaperps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "settings", settings: { discordWebhook: webhook, notifyOnNew } }),
    });
    const data = await res.json();
    if (data.ok) {
      state = data.state || state;
      dom.discordNote.textContent = webhook ? "Webhook saved. Alerts are active." : "Webhook cleared.";
    } else {
      dom.discordNote.textContent = data.error || "Save failed.";
    }
  } catch (err) {
    dom.discordNote.textContent = `Error: ${err.message}`;
  }
}

async function resetPaper() {
  if (!confirm("Reset paper trading? This clears all positions and resets balance to $100.")) return;
  try {
    const res = await fetch("/api/emaperps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "paper-reset" }),
    });
    const data = await res.json();
    if (data.ok && data.state) {
      state = data.state;
      renderPaperTab();
    }
  } catch (err) {
    alert(`Reset failed: ${err.message}`);
  }
}

// ─── Event wiring ────────────────────────────────────────────────────────────
dom.searchBtn.addEventListener("click", doSearch);
dom.searchInput.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });
dom.scanBtn.addEventListener("click", triggerScan);
dom.discordSave.addEventListener("click", saveDiscord);
if (dom.paperReset) dom.paperReset.addEventListener("click", resetPaper);

// Signal feed tabs
document.querySelectorAll("[data-ep-tab]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-ep-tab]").forEach(b => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    currentTab = btn.dataset.epTab;
    renderFeed();
  });
});

// Page-level tabs
document.querySelectorAll("[data-ep-page]").forEach(btn => {
  btn.addEventListener("click", () => switchPage(btn.dataset.epPage));
});

// ─── Test Alerts ─────────────────────────────────────────────────────────────
const EP_TEST_FAKE_EVENT = {
  type: "perps",
  pair: "ETHUSDT",
  symbol: "ETHUSDT",
  direction: "LONG",
  side: "Long",
  entryPrice: 3750,
  stopLoss: 3620,
  tp1: 3920,
  tp2: 4100,
  qualityScore: 80,
  qualificationReason: "EMA50 + Support 2 · Q85 strong signal · RSI 52 · HTF uptrend",
  strategy: "EMA PERPS",
};

const EP_TEST_EVENT_OVERRIDES = {
  entry_opened: {},
  tp1_hit:  { closedPrice: 3920, pnlPct: 4.53, pnl:  4.53 },
  tp2_hit:  { closedPrice: 4100, pnlPct: 9.33, pnl:  9.33 },
  sl_hit:   { closedPrice: 3620, pnlPct: -3.47, pnl: -3.47 },
};

const EP_TEST_TITLES = {
  entry_opened: "📡 ETHUSDT Q80 — EMA Perps · Test Entry",
  tp1_hit:      "✅ ETHUSDT — TP1 Hit — EMA Perps · Test",
  tp2_hit:      "🏆 ETHUSDT — TP2 Hit — EMA Perps · Test",
  sl_hit:       "🔴 ETHUSDT — SL Hit — EMA Perps · Test",
};

function setTestResult(msg, type = "ok") {
  if (!dom.testResult) return;
  dom.testResult.textContent = msg;
  dom.testResult.className = `test-result test-result--${type}`;
}

function initTestTab() {
  if (dom.testWebhook && state?.alertDelivery?.discordWebhook && !dom.testWebhook.value) {
    dom.testWebhook.value = state.alertDelivery.discordWebhook;
  }
}

async function runEpTestAlert(eventType) {
  const webhook = dom.testWebhook?.value?.trim();
  if (!webhook || !/^https:\/\/discord(app)?\.com\/api\/webhooks\//.test(webhook)) {
    setTestResult("⚠ Enter a valid Discord webhook URL first.", "err");
    return;
  }
  const allBtns = document.querySelectorAll("[data-ep-test]");
  allBtns.forEach(b => { b.disabled = true; });
  setTestResult("Sending…", "busy");
  try {
    const event = { ...EP_TEST_FAKE_EVENT, ...(EP_TEST_EVENT_OVERRIDES[eventType] || {}) };
    const res = await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: EP_TEST_TITLES[eventType] || "Soloris Test Alert",
        event,
        meta: { eventType },
        destinations: { discordWebhook: webhook },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.results?.discord === "sent") {
      setTestResult("✓ Alert sent — check your Discord channel.", "ok");
    } else {
      setTestResult(`✗ ${data?.error || data?.results?.discord || "Delivery failed"}`, "err");
    }
  } catch (err) {
    setTestResult(`✗ ${err.message}`, "err");
  } finally {
    allBtns.forEach(b => { b.disabled = false; });
  }
}

document.querySelectorAll("[data-ep-test]").forEach(btn => {
  btn.addEventListener("click", () => runEpTestAlert(btn.dataset.epTest));
});

// ─── Auto-refresh ────────────────────────────────────────────────────────────
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(fetchState, POLL_INTERVAL_MS);
}

async function init() {
  setStatus("Loading…", "neutral");
  await fetchState();
  startPolling();
}

init();
