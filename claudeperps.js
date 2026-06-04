"use strict";
// Claudeperps frontend — Multi-Timeframe Momentum Confluence strategy

// ─── State ───────────────────────────────────────────────────────────────────
let state = {
  signals: [], lastScanAt: 0,
  alertDelivery: { discordWebhook: "", notifyOnNew: true },
  paper: { balance: 100, startingBalance: 100, openPositions: [], closedTrades: [], lastMarkAt: 0 },
  lastScanResults: [],
};
let currentTab    = "active";
let currentPage   = "signals";
let activeChart   = null;
let pollTimer     = null;
const POLL_INTERVAL_MS = 30_000;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const dom = {
  statusDot:      document.getElementById("cp-status-dot"),
  statusMsg:      document.getElementById("cp-status-msg"),
  lastScan:       document.getElementById("cp-last-scan"),
  searchInput:    document.getElementById("cp-search-input"),
  searchBtn:      document.getElementById("cp-search-btn"),
  scanBtn:        document.getElementById("cp-scan-btn"),
  searchResult:   document.getElementById("cp-search-result"),
  signalFeed:     document.getElementById("cp-signal-feed"),
  chartContainer: document.getElementById("cp-chart-container"),
  chartSymbol:    document.getElementById("cp-chart-symbol"),
  chartLevels:    document.getElementById("cp-chart-levels"),
  discordInput:   document.getElementById("cp-discord-input"),
  discordNotify:  document.getElementById("cp-discord-notify"),
  discordSave:    document.getElementById("cp-discord-save"),
  discordNote:    document.getElementById("cp-discord-note"),
  metricActive:   document.getElementById("cp-metric-active"),
  metricToday:    document.getElementById("cp-metric-today"),
  metricLongs:    document.getElementById("cp-metric-longs"),
  metricShorts:   document.getElementById("cp-metric-shorts"),
  metricAvgQ:     document.getElementById("cp-metric-avgq"),
  metricScan:     document.getElementById("cp-metric-scan"),
  metricScanNote: document.getElementById("cp-metric-scan-note"),
  // Page tabs
  pageSections: {
    signals: document.getElementById("cp-page-signals"),
    scanner: document.getElementById("cp-page-scanner"),
    paper:   document.getElementById("cp-page-paper"),
    test:    document.getElementById("cp-page-test"),
    stats:   document.getElementById("cp-page-stats"),
  },
  // Stats tab
  statTotal:    document.getElementById("cp-stat-total"),
  statResolved: document.getElementById("cp-stat-resolved"),
  statWinrate:  document.getElementById("cp-stat-winrate"),
  statTp2rate:  document.getElementById("cp-stat-tp2rate"),
  statAvgQ:     document.getElementById("cp-stat-avgq"),
  statPending:  document.getElementById("cp-stat-pending"),
  statReturn:   document.getElementById("cp-stat-return"),
  statPWinrate: document.getElementById("cp-stat-pwinrate"),
  statPF:       document.getElementById("cp-stat-pf"),
  statAvgWin:   document.getElementById("cp-stat-avgwin"),
  statAvgLoss:  document.getElementById("cp-stat-avgloss"),
  statTrades:   document.getElementById("cp-stat-trades"),
  statQTable:   document.getElementById("cp-stat-qtable"),
  equityChart:  document.getElementById("cp-equity-chart"),
  statOutcomes: document.getElementById("cp-stat-outcomes"),
  // Test alerts
  testWebhook:  document.getElementById("cp-test-webhook"),
  testResult:   document.getElementById("cp-test-result"),
  // Scanner
  scannerFeed:   document.getElementById("cp-scanner-feed"),
  scannerTitle:  document.getElementById("cp-scanner-title"),
  scannerMeta:   document.getElementById("cp-scanner-meta"),
  // Paper
  paperBalance:    document.getElementById("cp-paper-balance"),
  paperStarting:   document.getElementById("cp-paper-starting"),
  paperPnl:        document.getElementById("cp-paper-pnl"),
  paperWinrate:    document.getElementById("cp-paper-winrate"),
  paperOpenCount:  document.getElementById("cp-paper-open-count"),
  paperClosedCount:document.getElementById("cp-paper-closed-count"),
  paperOpen:       document.getElementById("cp-paper-open"),
  paperClosed:     document.getElementById("cp-paper-closed"),
  paperReset:      document.getElementById("cp-paper-reset"),
  // Comparison
  comparison:      document.getElementById("cp-comparison"),
  compareMeta:     document.getElementById("cp-compare-meta"),
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
  if (q >= 80) return "High Conviction";
  if (q >= 70) return "Good Setup";
  return "Valid Signal";
}

// ─── Page tabs ───────────────────────────────────────────────────────────────
function switchPage(page) {
  currentPage = page;
  Object.entries(dom.pageSections).forEach(([key, el]) => {
    if (el) el.hidden = key !== page;
  });
  document.querySelectorAll("[data-cp-page]").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.cpPage === page);
  });
  if (page === "scanner") renderScannerTab();
  if (page === "paper") { renderPaperTab(); loadComparison(); }
  if (page === "test") initTestTab();
  if (page === "stats") renderStatsTab();
}

// ─── Metrics ─────────────────────────────────────────────────────────────────
function renderMetrics() {
  const active = state.signals.filter(s => s.status === "active");
  const now = Date.now();
  const today = state.signals.filter(s => now - s.detectedAt < 86_400_000);
  const longs = active.filter(s => s.side === "Long").length;
  const shorts = active.filter(s => s.side === "Short").length;
  const avgQ = active.length
    ? Math.round(active.reduce((a, s) => a + s.quality, 0) / active.length)
    : null;

  dom.metricActive.textContent  = active.length || "–";
  dom.metricToday.textContent   = today.length || "–";
  dom.metricLongs.textContent   = longs || "–";
  dom.metricShorts.textContent  = shorts || "–";
  dom.metricAvgQ.textContent    = avgQ != null ? `Q${avgQ}` : "–";
  if (state.lastScanAt) dom.metricScan.textContent = timeAgo(state.lastScanAt);
}

// ─── Signal feed ─────────────────────────────────────────────────────────────
function renderSignalCard(signal) {
  const isLong = signal.side === "Long";
  const dir    = isLong ? "long" : "short";
  const prec   = signal.pricePrecision || 2;
  const reasons = (signal.reasonLabels || []).slice(0, 3).join(" · ");

  const pctEntry = (v) => {
    if (!signal.entryPrice || !v) return "";
    const p = ((v - signal.entryPrice) / signal.entryPrice) * 100;
    return `<span class="level-meta">${p >= 0 ? "+" : ""}${p.toFixed(1)}%</span>`;
  };

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
          </div>
          <div class="level-row">
            <span class="level-label">SL</span>
            <span class="level-value tone-down">${fp(signal.sl, prec)}</span>
            ${pctEntry(signal.sl)}
          </div>
          <div class="level-row">
            <span class="level-label">TP1</span>
            <span class="level-value tone-up">${fp(signal.tp1, prec)}</span>
            <span class="level-rr">1.5R</span>
          </div>
          <div class="level-row">
            <span class="level-label">TP2</span>
            <span class="level-value tone-up">${fp(signal.tp2, prec)}</span>
            <span class="level-rr">2.5R</span>
          </div>
        </div>

        <div class="sc-footer">
          <span class="sc-reasons">${reasons}</span>
          ${signal.outcome ? `<span class="sc-outcome-badge sc-outcome--${signal.outcome.toLowerCase()}">${
            signal.outcome === "TP2" ? "🏆 TP2" :
            signal.outcome === "TP1" ? "✅ TP1" : "❌ SL"
          }</span>` : signal.alertedAt > 0 ? `<span class="sc-outcome-badge sc-outcome--pending">⏳ Tracking</span>` : ""}
          <span class="sc-time">${timeAgo(signal.detectedAt)}</span>
        </div>
      </div>
    </article>`;
}

function renderFeed() {
  const now = Date.now();
  let filtered = state.signals;
  if (currentTab === "active") filtered = state.signals.filter(s => s.status === "active");
  else if (currentTab === "all") filtered = state.signals.filter(s => now - s.detectedAt < 86_400_000);

  if (!filtered.length) {
    dom.signalFeed.innerHTML = `<div class="feed-empty">
      <p>${currentTab === "active" ? "No active signals right now. Scanner runs every 5 min." : "No signals in the last 24 hours."}</p>
    </div>`;
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
  const reasons = (signal.reasonLabels || []).slice(0, 4);

  return `
    <div class="scanner-card scanner-card--${dir}">
      <div class="scanner-card-head">
        <span class="scanner-symbol">${signal.symbol}</span>
        <span class="scanner-side scanner-side--${dir}">${signal.side}</span>
      </div>
      <div class="scanner-quality">Q${signal.quality} · ${qualityLabel(signal.quality)}</div>
      <div class="scanner-levels">
        <div class="scanner-level-row"><span>Entry</span><span>${fp(signal.entryPrice, prec)}</span></div>
        <div class="scanner-level-row"><span>TP1</span><span class="tone-up">${fp(signal.tp1, prec)}</span></div>
        <div class="scanner-level-row"><span>TP2</span><span class="tone-up">${fp(signal.tp2, prec)}</span></div>
        <div class="scanner-level-row"><span>SL</span><span class="tone-down">${fp(signal.sl, prec)}</span></div>
      </div>
      ${reasons.length ? `<div class="scanner-reasons">${reasons.map(r => `<span class="scanner-reason-chip">${r}</span>`).join("")}</div>` : ""}
    </div>`;
}

function renderScannerTab() {
  const results = state.lastScanResults || [];
  if (!dom.scannerFeed) return;
  if (!results.length) {
    dom.scannerFeed.innerHTML = `<div class="scanner-empty">No scan results yet. Click "Run Scanner" to scan all tokens.</div>`;
    if (dom.scannerTitle) dom.scannerTitle.textContent = "Scanner results";
    if (dom.scannerMeta) dom.scannerMeta.textContent = "Run scanner to see all matching tokens";
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

  // ── P&L calculation ──────────────────────────────────────────────────────────
  let pnlClass, pnlStr;
  const lev = pos.leverage || 1;

  if (isClosed) {
    const leveragedPct = (pos.pnlPct || 0);
    pnlClass = pnl == null ? "paper-pos-pnl--zero" : pnl > 0 ? "paper-pos-pnl--pos" : pnl < 0 ? "paper-pos-pnl--neg" : "paper-pos-pnl--zero";
    pnlStr = pnl != null ? `${pnl >= 0 ? "+" : ""}${fmt$(pnl)} (${fPct(leveragedPct)})` : "–";
  } else if (pos.lastMarkPrice && pos.entryPrice) {
    const markDiff      = isLong ? pos.lastMarkPrice - pos.entryPrice : pos.entryPrice - pos.lastMarkPrice;
    const rawPct        = (markDiff / pos.entryPrice) * 100;
    const leveragedPct  = rawPct * lev;
    const unrealizedUsd = (markDiff / pos.entryPrice) * pos.size * lev;
    pnlClass = leveragedPct > 0 ? "paper-pos-pnl--pos" : leveragedPct < 0 ? "paper-pos-pnl--neg" : "paper-pos-pnl--zero";
    pnlStr   = `${leveragedPct >= 0 ? "+" : ""}${fmt$(unrealizedUsd)} (${fPct(leveragedPct)})`;
  } else {
    pnlClass = "paper-pos-pnl--zero";
    pnlStr   = "–";
  }

  // ── Open-position live levels block ──────────────────────────────────────────
  let liveLevelsHtml = "";
  if (!isClosed && pos.lastMarkPrice && pos.entryPrice) {
    const mark     = pos.lastMarkPrice;
    const movePct  = ((isLong ? mark - pos.entryPrice : pos.entryPrice - mark) / pos.entryPrice * 100).toFixed(1);
    const moveSign = Number(movePct) >= 0 ? "+" : "";
    const toTP1    = pos.tp1 ? ((isLong ? pos.tp1 - mark : mark - pos.tp1) / mark * 100) : null;
    const toTP2    = pos.tp2 ? ((isLong ? pos.tp2 - mark : mark - pos.tp2) / mark * 100) : null;
    const toSL     = pos.sl  ? ((isLong ? mark - pos.sl  : pos.sl - mark ) / mark * 100) : null;
    const fDist    = (v, label, cls) => v != null
      ? `<span class="pos-level-row ${cls}"><span class="pos-level-tag">${label}</span><span class="pos-level-dist">${v > 0 ? v.toFixed(1) + "% away" : "REACHED"}</span><span class="pos-level-price">${fp(label === "TP1" ? pos.tp1 : label === "TP2" ? pos.tp2 : pos.sl, prec)}</span></span>`
      : "";
    liveLevelsHtml = `
      <div class="pos-live-row">
        <span class="pos-live-now">Now <strong>${fp(mark, prec)}</strong></span>
        <span class="pos-live-move ${Number(movePct) >= 0 ? "tone-up" : "tone-down"}">${moveSign}${movePct}% from entry</span>
        ${lev > 1 ? `<span class="pos-live-lev">${lev}×</span>` : ""}
      </div>
      <div class="pos-levels-strip">
        ${fDist(toSL,  "SL",  "pos-level--sl")}
        ${fDist(toTP1, "TP1", "pos-level--tp1")}
        ${fDist(toTP2, "TP2", "pos-level--tp2")}
      </div>`;
  }

  const tp1Badge = pos.tp1Reached && !isClosed ? `<span class="paper-pos-tp1-badge">TP1 ✓  SL→Breakeven</span>` : "";

  return `
    <div class="${cardClass}">
      <div class="paper-pos-head">
        <div class="paper-pos-ident">
          <span class="paper-pos-symbol">${pos.symbol}</span>
          <span class="paper-pos-side paper-pos-side--${dir}">${pos.side.toUpperCase()}</span>
          ${!isClosed ? `<span class="paper-pos-status">LIVE</span>` : ""}
        </div>
        <div class="paper-pos-right">
          <span class="paper-pos-pnl ${pnlClass}">${pnlStr}</span>
          ${reasonHtml}
        </div>
      </div>
      ${tp1Badge}
      ${liveLevelsHtml}
      <div class="paper-pos-meta">
        <span>Entry ${fp(pos.entryPrice, prec)} · Size ${fmt$(pos.size)}${lev > 1 ? " · " + lev + "×" : ""} · Q${pos.quality}</span>
        <span>${isClosed ? timeAgo(pos.closedAt) : "Opened " + timeAgo(pos.openedAt)}</span>
      </div>
      ${isClosed ? `<div class="paper-pos-meta">
        <span>TP1 ${fp(pos.tp1, prec)} · TP2 ${fp(pos.tp2, prec)} · SL ${fp(pos.sl, prec)}</span>
        ${pos.closedPrice ? `<span>Close ${fp(pos.closedPrice, prec)}</span>` : ""}
      </div>` : ""}
    </div>`;
}

async function refreshMarkPrices() {
  const openPos = state.paper?.openPositions || [];
  if (!openPos.length) return;
  const symbols = [...new Set(openPos.map(p => p.symbol))];
  const priceMap = {};
  await Promise.allSettled(symbols.map(async sym => {
    try {
      const r = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${sym}`);
      const d = await r.json();
      if (d?.price) priceMap[sym] = parseFloat(d.price);
    } catch (_) {}
  }));
  let updated = false;
  openPos.forEach(pos => {
    if (priceMap[pos.symbol] && priceMap[pos.symbol] !== pos.lastMarkPrice) {
      pos.lastMarkPrice = priceMap[pos.symbol];
      pos.lastMarkAt    = Date.now();
      updated = true;
    }
  });
  if (updated && currentPage === "paper") renderPaperTab();
}

function renderPaperTab() {
  const paper = state.paper || {};
  const balance   = paper.balance ?? 100;
  const starting  = paper.startingBalance ?? 100;
  const openPos   = paper.openPositions || [];
  const closed    = paper.closedTrades  || [];

  const totalPnl  = balance - starting;
  const wins      = closed.filter(t => t.pnl != null && t.pnl > 0).length;
  const winrate   = closed.length ? Math.round((wins / closed.length) * 100) : null;

  if (dom.paperBalance)     dom.paperBalance.textContent    = fmt$(balance);
  if (dom.paperStarting)    dom.paperStarting.textContent   = fmt$(starting);
  if (dom.paperPnl) {
    dom.paperPnl.textContent = (totalPnl >= 0 ? "+" : "") + fmt$(totalPnl);
    dom.paperPnl.className = `stat-value ${totalPnl > 0 ? "tone-up" : totalPnl < 0 ? "tone-down" : ""}`;
  }
  if (dom.paperWinrate)     dom.paperWinrate.textContent    = winrate != null ? `${winrate}%` : "–";
  if (dom.paperOpenCount)   dom.paperOpenCount.textContent  = openPos.length;
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

  if (openPos.length) refreshMarkPrices();
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

    const cpState = cpRes.state || {};
    const epState = epRes.state || {};

    const cpPaper = cpState.paper || {};
    const epPaper = epState.paper || {};

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

    function row(label, cpVal, epVal, isPositive = null) {
      return `<div class="compare-row">
        <span class="compare-row-label">${label}</span>
        <span class="compare-row-value ${cpVal > 0 && isPositive === true ? "compare-row-value--pos" : cpVal < 0 && isPositive === true ? "compare-row-value--neg" : ""}">${cpVal}</span>
        <span class="compare-row-value ${epVal > 0 && isPositive === true ? "compare-row-value--pos" : epVal < 0 && isPositive === true ? "compare-row-value--neg" : ""}">${epVal}</span>
      </div>`;
    }

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
      const ema20 = chart.addLineSeries({ color: "#38bdf8", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
      ema20.setData(data.ema20Series);
    }

    if (data.ema50Series?.length > 1) {
      const ema50 = chart.addLineSeries({ color: "#a78bfa", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
      ema50.setData(data.ema50Series);
    }

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

    if (signal) renderLevelsRow(signal, data);
  } catch (err) {
    container.innerHTML = `<p class="chart-empty">Chart error: ${err.message}</p>`;
  }
}

function renderLevelsRow(signal, data) {
  const prec  = signal?.pricePrecision || data?.pricePrecision || 2;
  const price = data?.currentPrice || signal?.entryPrice;
  dom.chartLevels.innerHTML = `
    <div class="levels-row">
      <span class="level-chip">Price <strong>${fp(price, prec)}</strong></span>
      <span class="level-chip tone-cyan">EMA20 <strong>${fp(data?.ema20, prec)}</strong></span>
      <span class="level-chip tone-violet">EMA50 <strong>${fp(data?.ema50, prec)}</strong></span>
      ${signal ? `<span class="level-chip tone-up">TP1 <strong>${fp(signal.tp1, prec)}</strong></span>` : ""}
      ${signal ? `<span class="level-chip tone-up">TP2 <strong>${fp(signal.tp2, prec)}</strong></span>` : ""}
      ${signal ? `<span class="level-chip tone-down">SL <strong>${fp(signal.sl, prec)}</strong></span>` : ""}
    </div>`;
}

async function openChartForSignal(signal) {
  dom.chartSymbol.textContent = `${signal.symbol} · ${signal.side} · Q${signal.quality}`;
  dom.chartContainer.innerHTML = '<p class="chart-empty">Loading chart…</p>';
  dom.chartLevels.innerHTML = "";
  try {
    const res = await fetch("/api/claudeperps", {
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

  const prec = data.pricePrecision || 2;
  const isUp = data.structureBias === "up";
  const trendClass = isUp ? "tone-up" : "tone-down";
  const trendLabel = isUp ? "▲ Bullish" : "▼ Bearish";
  const signal = data.signal;

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
        <div class="analysis-ind"><span>1H EMA20</span><strong class="tone-cyan">${fp(data.ema20, prec)}</strong></div>
        <div class="analysis-ind"><span>1H EMA50</span><strong class="tone-violet">${fp(data.ema50, prec)}</strong></div>
        <div class="analysis-ind"><span>4H EMA20</span><strong>${data.ema20_4h ? fp(data.ema20_4h, prec) : "–"}</strong></div>
        <div class="analysis-ind"><span>4H EMA50</span><strong>${data.ema50_4h ? fp(data.ema50_4h, prec) : "–"}</strong></div>
        <div class="analysis-ind"><span>RSI (14)</span><strong>${data.rsi ? Number(data.rsi).toFixed(1) : "–"}</strong></div>
        <div class="analysis-ind"><span>MACD hist</span><strong>${data.macd?.hist != null ? Number(data.macd.hist).toFixed(5) : "–"}</strong></div>
        <div class="analysis-ind"><span>ATR</span><strong>${fp(data.atr, prec)}</strong></div>
        <div class="analysis-ind"><span>Funding</span><strong>${data.fundingRate != null ? fPct(data.fundingRate, 4) : "–"}</strong></div>
        <div class="analysis-ind"><span>24H Change</span><strong class="${data.change24h >= 0 ? "tone-up" : "tone-down"}">${fPct(data.change24h)}</strong></div>
        <div class="analysis-ind"><span>Volume 24H</span><strong>$${data.volume24h ? (data.volume24h / 1_000_000).toFixed(0) + "M" : "–"}</strong></div>
      </div>
      ${signal ? `
        <div class="analysis-signal">
          <div class="analysis-signal-title">${signal.side} · ${(signal.reasonLabels || []).slice(0,3).join(" · ")}</div>
          <div class="analysis-levels">
            <span class="level-chip-sm">Entry ${fp(signal.entryPrice, prec)}</span>
            <span class="level-chip-sm tp">TP1 ${fp(signal.tp1, prec)}</span>
            <span class="level-chip-sm tp">TP2 ${fp(signal.tp2, prec)}</span>
            <span class="level-chip-sm sl">SL ${fp(signal.sl, prec)}</span>
          </div>
        </div>` : ""}
    </div>`;

  dom.chartSymbol.textContent = `${data.symbol} · Analysis`;
  renderChart(data, signal || null);
}

async function doSearch() {
  const token = dom.searchInput.value.trim();
  if (!token) return;
  dom.searchResult.innerHTML = `<div class="search-loading">Analyzing ${token.toUpperCase()}…</div>`;
  dom.chartContainer.innerHTML = '<p class="chart-empty">Loading chart…</p>';
  try {
    const res = await fetch("/api/claudeperps", {
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
  const res = await fetch("/api/claudeperps");
  const data = await res.json();
  if (data.ok && data.state) {
    state = data.state;
    renderMetrics();
    renderFeed();
    updateLastScanLabel();
    setStatus(state.lastStatusMessage || "Ready.", state.lastStatusTone || "neutral");
    if (state.alertDelivery?.discordWebhook) {
      dom.discordInput.value  = state.alertDelivery.discordWebhook;
      dom.discordNotify.checked = state.alertDelivery.notifyOnNew !== false;
    }
    // Refresh whichever page-tab is visible
    if (currentPage === "scanner") renderScannerTab();
    if (currentPage === "paper")   { renderPaperTab(); }
  }
}

async function triggerScan() {
  dom.scanBtn.disabled = true;
  dom.scanBtn.textContent = "Scanning…";
  setStatus("Running scanner…", "neutral");
  try {
    const res = await fetch("/api/claudeperps", {
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
  const webhook    = dom.discordInput.value.trim();
  const notifyOnNew = dom.discordNotify.checked;
  dom.discordNote.textContent = "Saving…";
  try {
    const res = await fetch("/api/claudeperps", {
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
    const res = await fetch("/api/claudeperps", {
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
document.querySelectorAll("[data-cp-tab]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-cp-tab]").forEach(b => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    currentTab = btn.dataset.cpTab;
    renderFeed();
  });
});

// ─── Equity Curve ────────────────────────────────────────────────────────────
function computeEquityCurve(startingBalance, closedTrades) {
  const sorted = [...closedTrades]
    .filter(t => t.closedAt && t.pnl != null)
    .sort((a, b) => a.closedAt - b.closedAt);
  if (!sorted.length) return [];
  let balance = startingBalance;
  const points = [{ time: Math.floor((sorted[0].openedAt || sorted[0].closedAt) / 1000) - 1, value: balance }];
  for (const trade of sorted) {
    balance = Math.max(0, Math.round((balance + Number(trade.pnl || 0)) * 100) / 100);
    points.push({ time: Math.floor(trade.closedAt / 1000), value: balance });
  }
  return points;
}

let cpEquityChart = null;

function renderEquityCurve() {
  const container = dom.equityChart;
  if (!container || typeof LightweightCharts === "undefined") return;
  const closedTrades = state.paper?.closedTrades || [];
  const startBal = state.paper?.startingBalance || 100;
  const points = computeEquityCurve(startBal, closedTrades);
  if (points.length < 2) {
    container.innerHTML = `<p class="equity-empty">Not enough closed trades to plot yet.</p>`;
    if (cpEquityChart) { cpEquityChart.remove(); cpEquityChart = null; }
    return;
  }
  container.innerHTML = "";
  if (cpEquityChart) { cpEquityChart.remove(); cpEquityChart = null; }
  cpEquityChart = LightweightCharts.createChart(container, {
    height: 140,
    layout: { background: { color: "transparent" }, textColor: "#888" },
    grid: { vertLines: { visible: false }, horzLines: { color: "rgba(255,255,255,0.05)" } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false, timeVisible: true },
    handleScroll: false, handleScale: false,
  });
  const finalBalance = points[points.length - 1].value;
  const lineColor = finalBalance >= startBal ? "#4ade80" : "#f87171";
  const series = cpEquityChart.addLineSeries({ color: lineColor, lineWidth: 2, priceLineVisible: false });
  series.setData(points);
  cpEquityChart.timeScale().fitContent();
}

// ─── Stats Tab ───────────────────────────────────────────────────────────────
function renderStatsTab() {
  const alertedSigs = state.signals.filter(s => s.alertedAt > 0);
  const resolved    = alertedSigs.filter(s => s.outcome != null);
  const wins        = resolved.filter(s => s.outcome === "TP1" || s.outcome === "TP2");
  const tp2s        = resolved.filter(s => s.outcome === "TP2");
  const pending     = alertedSigs.filter(s => !s.outcomeSent);
  const avgQ        = alertedSigs.length
    ? Math.round(alertedSigs.reduce((a, s) => a + s.quality, 0) / alertedSigs.length) : null;
  const winRate     = resolved.length ? Math.round(wins.length / resolved.length * 100) : null;
  const tp2Rate     = resolved.length ? Math.round(tp2s.length / resolved.length * 100) : null;

  if (dom.statTotal)    dom.statTotal.textContent    = alertedSigs.length || "–";
  if (dom.statResolved) dom.statResolved.textContent = resolved.length || "–";
  if (dom.statWinrate)  { dom.statWinrate.textContent = winRate != null ? `${winRate}%` : "–"; dom.statWinrate.className = `stat-value ${winRate >= 50 ? "tone-up" : winRate != null ? "tone-down" : ""}`; }
  if (dom.statTp2rate)  dom.statTp2rate.textContent  = tp2Rate != null ? `${tp2Rate}%` : "–";
  if (dom.statAvgQ)     dom.statAvgQ.textContent     = avgQ != null ? `Q${avgQ}` : "–";
  if (dom.statPending)  dom.statPending.textContent  = pending.length || "–";

  // Paper trade stats
  const closed       = state.paper?.closedTrades || [];
  const closedWins   = closed.filter(t => (t.pnl ?? 0) > 0);
  const closedLosses = closed.filter(t => (t.pnl ?? 0) <= 0);
  const grossProfit  = closedWins.reduce((a, t) => a + (t.pnl || 0), 0);
  const grossLoss    = Math.abs(closedLosses.reduce((a, t) => a + (t.pnl || 0), 0));
  const pf           = grossLoss > 0 ? (grossProfit / grossLoss) : (grossProfit > 0 ? 99 : null);
  const avgWin       = closedWins.length   ? closedWins.reduce((a, t) => a + (t.pnlPct || 0), 0) / closedWins.length   : null;
  const avgLoss      = closedLosses.length ? closedLosses.reduce((a, t) => a + (t.pnlPct || 0), 0) / closedLosses.length : null;
  const pWinRate     = closed.length ? Math.round(closedWins.length / closed.length * 100) : null;
  const totalReturn  = state.paper?.startingBalance
    ? ((state.paper.balance - state.paper.startingBalance) / state.paper.startingBalance * 100) : null;

  if (dom.statReturn)  { const v = totalReturn; dom.statReturn.textContent = v != null ? fPct(v, 1) : "–"; dom.statReturn.className = `stat-value ${v >= 0 ? "tone-up" : "tone-down"}`; }
  if (dom.statPWinrate){ dom.statPWinrate.textContent = pWinRate != null ? `${pWinRate}%` : "–"; dom.statPWinrate.className = `stat-value ${pWinRate >= 50 ? "tone-up" : pWinRate != null ? "tone-down" : ""}`; }
  if (dom.statPF)      dom.statPF.textContent      = pf != null ? (pf >= 99 ? "∞" : pf.toFixed(2)) : "–";
  if (dom.statAvgWin)  { dom.statAvgWin.textContent  = avgWin  != null ? `+${avgWin.toFixed(1)}%`  : "–"; if (avgWin  != null) dom.statAvgWin.className  = "stat-value tone-up";  }
  if (dom.statAvgLoss) { dom.statAvgLoss.textContent = avgLoss != null ? `${avgLoss.toFixed(1)}%` : "–"; if (avgLoss != null) dom.statAvgLoss.className = "stat-value tone-down"; }
  if (dom.statTrades)  dom.statTrades.textContent   = closed.length || "–";

  // Quality tier table (using alerted signals with outcomes)
  if (dom.statQTable) {
    const tiers = [
      { label: "Q78–84", min: 78, max: 84 },
      { label: "Q85–89", min: 85, max: 89 },
      { label: "Q90–94", min: 90, max: 94 },
      { label: "Q95+",   min: 95, max: 999 },
    ];
    const rows = tiers.map(({ label, min, max }) => {
      const sigs = alertedSigs.filter(s => s.quality >= min && s.quality <= max);
      const res  = sigs.filter(s => s.outcome != null);
      const w    = res.filter(s => s.outcome === "TP1" || s.outcome === "TP2").length;
      const l    = res.filter(s => s.outcome === "SL").length;
      const wr   = res.length ? Math.round(w / res.length * 100) : null;
      return `<div class="perf-row">
        <span class="perf-row-label">${label}</span>
        <span class="perf-row-count">${sigs.length} alerted</span>
        <span class="perf-row-detail"><span class="tone-up">${w}W</span> / <span class="tone-down">${l}L</span></span>
        <span class="perf-row-wr ${wr == null ? "" : wr >= 50 ? "tone-up" : "tone-down"}">${wr != null ? `${wr}%` : "–"}</span>
      </div>`;
    });
    dom.statQTable.innerHTML = rows.join("") || `<p class="perf-empty">No alerted signals yet.</p>`;
  }

  // Recent outcomes list
  if (dom.statOutcomes) {
    const recent = resolved.slice().sort((a, b) => (b.alertedAt || 0) - (a.alertedAt || 0)).slice(0, 12);
    if (!recent.length) {
      dom.statOutcomes.innerHTML = `<p class="perf-empty">No resolved signals yet. Outcomes appear after TP/SL is hit.</p>`;
    } else {
      dom.statOutcomes.innerHTML = recent.map(s => {
        const badgeClass = s.outcome === "TP2" ? "outcome--tp2" : s.outcome === "TP1" ? "outcome--tp1" : "outcome--sl";
        const badgeText  = s.outcome === "TP2" ? "🏆 TP2" : s.outcome === "TP1" ? "✅ TP1" : "❌ SL";
        const pct = s.outcome === "TP2" ? (Math.abs((s.tp2 - s.entryPrice) / s.entryPrice * 100)).toFixed(1)
                  : s.outcome === "TP1" ? (Math.abs((s.tp1 - s.entryPrice) / s.entryPrice * 100)).toFixed(1)
                  : (Math.abs((s.sl  - s.entryPrice) / s.entryPrice * 100)).toFixed(1);
        const sign = s.outcome === "SL" ? "-" : "+";
        return `<div class="perf-outcome-row">
          <span class="por-symbol">${s.symbol}</span>
          <span class="por-side ${s.side === "Long" ? "tone-up" : "tone-down"}">${s.side.toUpperCase()}</span>
          <span class="por-q">Q${s.quality}</span>
          <span class="por-badge ${badgeClass}">${badgeText}</span>
          <span class="por-pct ${s.outcome === "SL" ? "tone-down" : "tone-up"}">${sign}${pct}%</span>
          <span class="por-time">${timeAgo(s.alertedAt)}</span>
        </div>`;
      }).join("");
    }
  }

  // Equity curve
  renderEquityCurve();
}

// Page-level tabs
document.querySelectorAll("[data-cp-page]").forEach(btn => {
  btn.addEventListener("click", () => switchPage(btn.dataset.cpPage));
});

// ─── Test Alerts ─────────────────────────────────────────────────────────────
const CP_TEST_FAKE_EVENT = {
  type: "perps",
  pair: "BTCUSDT",
  symbol: "BTCUSDT",
  direction: "LONG",
  side: "Long",
  entryPrice: 98500,
  stopLoss: 96800,
  tp1: 101000,
  tp2: 104500,
  qualityScore: 88,
  qualificationReason: "EMA20 > EMA50 · RSI 55 · Bullish MACD cross · Strong volume · 4H uptrend",
  strategy: "CLAUDEPERPS",
};

const CP_TEST_EVENT_OVERRIDES = {
  entry_opened: {},
  tp1_hit:  { closedPrice: 101000, pnlPct: 2.54, pnl:  2.54 },
  tp2_hit:  { closedPrice: 104500, pnlPct: 6.09, pnl:  6.09 },
  sl_hit:   { closedPrice:  96800, pnlPct: -1.73, pnl: -1.73 },
};

const CP_TEST_TITLES = {
  entry_opened: "📡 BTCUSDT Q88 — Claudeperps · Test Entry",
  tp1_hit:      "✅ BTCUSDT — TP1 Hit — Claudeperps · Test",
  tp2_hit:      "🏆 BTCUSDT — TP2 Hit — Claudeperps · Test",
  sl_hit:       "🔴 BTCUSDT — SL Hit — Claudeperps · Test",
};

function setTestResult(msg, type = "ok") {
  if (!dom.testResult) return;
  dom.testResult.textContent = msg;
  dom.testResult.className = `test-result test-result--${type}`;
}

function initTestTab() {
  // Pre-fill webhook from saved state
  if (dom.testWebhook && state?.alertDelivery?.discordWebhook && !dom.testWebhook.value) {
    dom.testWebhook.value = state.alertDelivery.discordWebhook;
  }
}

async function runCpTestAlert(eventType) {
  const webhook = dom.testWebhook?.value?.trim();
  if (!webhook || !/^https:\/\/discord(app)?\.com\/api\/webhooks\//.test(webhook)) {
    setTestResult("⚠ Enter a valid Discord webhook URL first.", "err");
    return;
  }
  const allBtns = document.querySelectorAll("[data-cp-test]");
  allBtns.forEach(b => { b.disabled = true; });
  setTestResult("Sending…", "busy");
  try {
    const event = { ...CP_TEST_FAKE_EVENT, ...(CP_TEST_EVENT_OVERRIDES[eventType] || {}) };
    const res = await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: CP_TEST_TITLES[eventType] || "Soloris Test Alert",
        event,
        meta: { eventType },
        destinations: { discordWebhook: webhook },
      }),
    });
    const rawText = await res.text().catch(() => "");
    let data = {};
    try { data = JSON.parse(rawText); } catch (_) {}
    const discordResult = data?.results?.discord;
    if (res.ok && discordResult === "sent") {
      setTestResult("✓ Alert sent — check your Discord channel.", "ok");
    } else {
      const detail = data?.error || discordResult || rawText.slice(0, 120) || `HTTP ${res.status}`;
      setTestResult(`✗ ${detail}`, "err");
    }
  } catch (err) {
    setTestResult(`✗ ${err.message}`, "err");
  } finally {
    allBtns.forEach(b => { b.disabled = false; });
  }
}

document.querySelectorAll("[data-cp-test]").forEach(btn => {
  btn.addEventListener("click", () => runCpTestAlert(btn.dataset.cpTest));
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
