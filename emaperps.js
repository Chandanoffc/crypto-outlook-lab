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
let activeChartSignal = null;
let activeChartTf     = "1h";
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
  chartReasoning: document.getElementById("ep-chart-reasoning"),
  chartTfTabs:    document.getElementById("ep-chart-tf-tabs"),
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
    stats:   document.getElementById("ep-page-stats"),
  },
  // Stats tab
  statTotal:    document.getElementById("ep-stat-total"),
  statResolved: document.getElementById("ep-stat-resolved"),
  statWinrate:  document.getElementById("ep-stat-winrate"),
  statTp2rate:  document.getElementById("ep-stat-tp2rate"),
  statAvgQ:     document.getElementById("ep-stat-avgq"),
  statPending:  document.getElementById("ep-stat-pending"),
  statReturn:   document.getElementById("ep-stat-return"),
  statPWinrate: document.getElementById("ep-stat-pwinrate"),
  statPF:       document.getElementById("ep-stat-pf"),
  statAvgWin:   document.getElementById("ep-stat-avgwin"),
  statAvgLoss:  document.getElementById("ep-stat-avgloss"),
  statTrades:   document.getElementById("ep-stat-trades"),
  statPTable:   document.getElementById("ep-stat-ptable"),
  statQTable:   document.getElementById("ep-stat-qtable"),
  statOutcomes: document.getElementById("ep-stat-outcomes"),
  equityChart:  document.getElementById("ep-equity-chart"),
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
  if (page === "stats")   renderStatsTab();
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
            ${signal.htfTrend ? `<span class="sc-htf-badge sc-htf--${signal.htfTrend}">4H ${signal.htfTrend === "up" ? "↑" : "↓"}${signal.htfLevelBonus ? " S/R" : ""}${signal.htfEmaBonus ? " EMA" : ""}</span>` : ""}
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
          <span class="sc-reasons">${(signal.reasonLabels || []).slice(0,6).join(" · ")}${signal.volume24h ? ` · $${signal.volume24h >= 1e9 ? (signal.volume24h/1e9).toFixed(1)+"B" : (signal.volume24h/1e6).toFixed(0)+"M"}` : ""}</span>
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
    else if (reason === "BE") cardClass = "paper-pos-card paper-pos-card--be";
    else cardClass = "paper-pos-card paper-pos-card--expired";

    const reasonClass = reason === "TP2" ? "tp2" : reason === "TP1" ? "tp1" : reason === "SL" ? "sl" : reason === "BE" ? "be" : "exp";
    reasonHtml = `<span class="paper-pos-reason paper-pos-reason--${reasonClass}">${reason === "BE" ? "BE" : reason || "CLOSED"}</span>`;
  }

  // ── P&L calculation ──────────────────────────────────────────────────────────
  let pnlClass, pnlStr;
  const lev = pos.leverage || 1;

  if (isClosed) {
    const leveragedPct = (pos.pnlPct || 0);   // already leveraged — stored that way
    pnlClass = pnl == null ? "paper-pos-pnl--zero" : pnl > 0 ? "paper-pos-pnl--pos" : pnl < 0 ? "paper-pos-pnl--neg" : "paper-pos-pnl--zero";
    pnlStr = pnl != null ? `${pnl >= 0 ? "+" : ""}${fmt$(pnl)} (${fPct(leveragedPct)})` : "–";
  } else if (pos.lastMarkPrice && pos.entryPrice) {
    const markDiff     = isLong ? pos.lastMarkPrice - pos.entryPrice : pos.entryPrice - pos.lastMarkPrice;
    const rawPct       = (markDiff / pos.entryPrice) * 100;
    const leveragedPct = rawPct * lev;
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
    const mark  = pos.lastMarkPrice;
    const pDist = (a, b) => ((Math.abs(a - b) / pos.entryPrice) * 100).toFixed(1);
    const movePct = ((isLong ? mark - pos.entryPrice : pos.entryPrice - mark) / pos.entryPrice * 100).toFixed(1);
    const moveSign = Number(movePct) >= 0 ? "+" : "";

    // Distance remaining to each level (from current price, not entry)
    const toTP1  = pos.tp1 ? ((isLong ? pos.tp1 - mark : mark - pos.tp1) / mark * 100) : null;
    const toTP2  = pos.tp2 ? ((isLong ? pos.tp2 - mark : mark - pos.tp2) / mark * 100) : null;
    const toSL   = pos.sl  ? ((isLong ? mark - pos.sl  : pos.sl - mark ) / mark * 100) : null;

    const fDist = (v, label, cls) => v != null
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

  const tp1Badge = pos.tp1Reached && !isClosed
    ? `<span class="paper-pos-tp1-badge">TP1 ✓  SL→Breakeven</span>` : "";
  const beBadge  = pos.slMovedToBE && !pos.tp1Reached && !isClosed
    ? `<span class="paper-pos-tp1-badge paper-pos-be-badge">🛡️ +25%  SL→Breakeven</span>` : "";

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
      ${tp1Badge}${beBadge}
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

// Fetch live mark prices for all open positions from Binance FAPI.
// Also detects TP1/TP2/SL hits and fires a server-side mark to close positions
// immediately — no manual scan needed when cron is delayed.
let epMarkInFlight = false; // prevent concurrent mark requests from this client

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
  let needsServerMark = false;
  openPos.forEach(pos => {
    const price = priceMap[pos.symbol];
    if (!price) return;
    if (price !== pos.lastMarkPrice) { pos.lastMarkPrice = price; pos.lastMarkAt = Date.now(); updated = true; }
    const isLong = pos.side === "Long";
    const hitSL  = pos.sl  && (isLong ? price <= pos.sl  : price >= pos.sl);
    const hitTP2 = pos.tp2 && (isLong ? price >= pos.tp2 : price <= pos.tp2);
    const hitTP1 = pos.tp1 && !pos.tp1Reached && (isLong ? price >= pos.tp1 : price <= pos.tp1);
    if (hitSL || hitTP2 || hitTP1) needsServerMark = true;
  });
  if (updated && currentPage === "paper") renderPaperTab();
  if (needsServerMark && !epMarkInFlight) {
    epMarkInFlight = true;
    try {
      const res = await fetch("/api/emaperps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "mark" }) });
      const data = await res.json();
      if (data.ok && data.state && !data.skipped) {
        state = data.state;
        if (currentPage === "paper") renderPaperTab();
      }
    } catch (_) {}
    finally { epMarkInFlight = false; }
  }
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

  // Always fetch fresh prices for open positions (independent of scan cycle)
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

// ─── Client-side Binance kline fetch + EMA ───────────────────────────────────
function clientEma(values, period) {
  if (values.length < period) return new Array(values.length).fill(null);
  const m = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result = new Array(period - 1).fill(null);
  result.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * m + prev * (1 - m);
    result.push(prev);
  }
  return result;
}

async function fetchBinanceKlines(symbol, interval, limit = 200) {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance ${res.status}`);
  const raw = await res.json();
  const candles = raw.map(k => ({
    time: Math.floor(k[0] / 1000),
    open:  parseFloat(k[1]),
    high:  parseFloat(k[2]),
    low:   parseFloat(k[3]),
    close: parseFloat(k[4]),
  }));
  const closes = candles.map(c => c.close);
  const e20 = clientEma(closes, 20);
  const e50 = clientEma(closes, 50);
  const ema20Series = candles.map((c, i) => e20[i] != null ? { time: c.time, value: e20[i] } : null).filter(Boolean);
  const ema50Series = candles.map((c, i) => e50[i] != null ? { time: c.time, value: e50[i] } : null).filter(Boolean);
  return { candles, ema20Series, ema50Series,
    ema20: e20[e20.length - 1], ema50: e50[e50.length - 1],
    currentPrice: candles[candles.length - 1]?.close };
}

// ─── Signal reasoning panel ───────────────────────────────────────────────────
function renderReasoningPanel(signal) {
  if (!dom.chartReasoning) return;
  if (!signal) { dom.chartReasoning.innerHTML = ""; return; }

  const prec = signal.pricePrecision || 4;
  const isLong = signal.side === "Long";
  const reasons = signal.reasonLabels || [];

  const q = signal.quality || 0;
  const qColor = q >= 90 ? "#F59E0B" : q >= 85 ? "#4ADE80" : "#38bdf8";

  const chipHtml = reasons.map(r => {
    const isPos = /uptrend|aligned|pullback|wick|demand|supply|rsi|adx|4H|tested|conflu/i.test(r);
    const isAmb = /approach|near|EMA20|EMA50/i.test(r);
    const cls = isAmb ? "cyan" : isPos ? "green" : "";
    return `<span class="reasoning-chip${cls ? " reasoning-chip--" + cls : ""}">${r}</span>`;
  }).join("");

  const slDist = signal.entryPrice && signal.sl
    ? Math.abs(((signal.entryPrice - signal.sl) / signal.entryPrice) * 100).toFixed(2)
    : "–";

  // Position sizing calculator
  const slDistRaw = signal.entryPrice && signal.sl ? Math.abs(signal.entryPrice - signal.sl) : 0;
  const calcId = `ps-${signal.id.replace(/[^a-z0-9]/gi, "")}`;

  // Pre-trade checklist
  const frVal = signal.fundingRate ?? null;
  const chkItems = [
    { label: "4H trend aligned with trade direction",  pass: true },
    { label: "Volume > $200M 24H",                    pass: (signal.volume24h || 0) >= 200e6 },
    { label: "RSI in 40–65 zone",                     pass: true },
    { label: "Funding neutral (< ±0.05%)",             pass: frVal == null || Math.abs(frVal) < 0.0005 },
    { label: "Level has 2+ prior touches",             pass: true },
    { label: "SL defined before entry",                pass: !!signal.sl },
    { label: "Position size calculated",               pass: false, interactive: true },
  ];
  const chkHtml = chkItems.map((it, i) => `
    <label class="chk-item${it.interactive ? " chk-item--action" : ""}">
      <input type="checkbox" class="chk-box" ${it.pass && !it.interactive ? "checked" : ""} data-chk="${i}">
      <span class="chk-dot ${it.pass && !it.interactive ? "chk-dot--pass" : it.interactive ? "chk-dot--action" : "chk-dot--fail"}"></span>
      <span class="chk-label">${it.label}</span>
    </label>`).join("");

  dom.chartReasoning.innerHTML = `
    <div class="reasoning-section">
      <div class="reasoning-section-title">Quality · ${q}/100</div>
      <div class="reasoning-quality-bar"><div class="reasoning-quality-fill" style="width:${Math.min(q,100)}%;background:${qColor}"></div></div>
    </div>
    ${reasons.length ? `<div class="reasoning-section">
      <div class="reasoning-section-title">Confluences</div>
      <div class="reasoning-chips">${chipHtml}</div>
    </div>` : ""}
    <div class="reasoning-section">
      <div class="reasoning-section-title">Trade Levels</div>
      <div class="reasoning-rows">
        <div class="reasoning-row"><span class="reasoning-row-label">Entry</span><span class="reasoning-row-value">${fp(signal.entryPrice, prec)}</span></div>
        <div class="reasoning-row"><span class="reasoning-row-label">TP1 (+2.5R)</span><span class="reasoning-row-value up">${fp(signal.tp1, prec)}</span></div>
        <div class="reasoning-row"><span class="reasoning-row-label">TP2 (+5R)</span><span class="reasoning-row-value up">${fp(signal.tp2, prec)}</span></div>
        <div class="reasoning-row"><span class="reasoning-row-label">SL (−${slDist}%)</span><span class="reasoning-row-value down">${fp(signal.sl, prec)}</span></div>
      </div>
    </div>
    <div class="reasoning-section">
      <div class="reasoning-section-title">Structure</div>
      <div class="reasoning-rows">
        <div class="reasoning-row"><span class="reasoning-row-label">Setup</span><span class="reasoning-row-value">${signal.signalLabel || signal.signalType || "–"}</span></div>
        <div class="reasoning-row"><span class="reasoning-row-label">EMA20</span><span class="reasoning-row-value" style="color:#38bdf8">${fp(signal.ema20, prec)}</span></div>
        <div class="reasoning-row"><span class="reasoning-row-label">EMA50</span><span class="reasoning-row-value" style="color:#a78bfa">${fp(signal.ema50, prec)}</span></div>
      </div>
    </div>
    <div class="reasoning-section">
      <div class="reasoning-section-title">Position Sizing</div>
      <div class="pos-calc" id="${calcId}">
        <div class="pos-calc-row">
          <label class="pos-calc-label">Account ($)</label>
          <input class="pos-calc-input" type="number" id="${calcId}-bal" value="100" min="1" step="10">
        </div>
        <div class="pos-calc-row">
          <label class="pos-calc-label">Risk per trade</label>
          <div class="pos-calc-pct-row">
            <button class="pos-pct-btn is-active" data-pct="1">1%</button>
            <button class="pos-pct-btn" data-pct="2">2%</button>
            <button class="pos-pct-btn" data-pct="3">3%</button>
          </div>
        </div>
        <div class="pos-calc-result" id="${calcId}-result"></div>
      </div>
    </div>
    <div class="reasoning-section">
      <div class="reasoning-section-title">Pre-Trade Checklist</div>
      <div class="chk-list">${chkHtml}</div>
    </div>`;
}

// ─── Position sizing calculator wiring ────────────────────────────────────────
function wirePosSizingCalc(signal) {
  const slDistRaw = signal.entryPrice && signal.sl ? Math.abs(signal.entryPrice - signal.sl) : 0;
  const calcId = `ps-${signal.id.replace(/[^a-z0-9]/gi, "")}`;
  const calcEl = document.getElementById(calcId);
  if (!calcEl) return;

  function computeSize() {
    const bal = parseFloat(document.getElementById(`${calcId}-bal`)?.value) || 100;
    const activeBtn = calcEl.querySelector(".pos-pct-btn.is-active");
    const riskPct = parseFloat(activeBtn?.dataset.pct || 2) / 100;
    const riskUsd = bal * riskPct;
    const slDist = slDistRaw || (signal.atr || 0);
    if (!slDist || !signal.entryPrice) return;
    const units = riskUsd / slDist;
    const notional = units * signal.entryPrice;
    const leverage = notional / bal;
    const resultEl = document.getElementById(`${calcId}-result`);
    if (!resultEl) return;
    resultEl.innerHTML = `
      <div class="psr-row"><span>Risk $</span><strong class="psr-risk">$${riskUsd.toFixed(2)}</strong></div>
      <div class="psr-row"><span>Position size</span><strong>${units.toFixed(4)} ${signal.symbol.replace("USDT","")}</strong></div>
      <div class="psr-row"><span>Notional</span><strong>$${notional.toFixed(2)}</strong></div>
      <div class="psr-row"><span>Effective leverage</span><strong class="${leverage > 5 ? "psr-warn" : "psr-ok"}">${leverage.toFixed(1)}×</strong></div>`;
  }

  calcEl.querySelectorAll(".pos-pct-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      calcEl.querySelectorAll(".pos-pct-btn").forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      computeSize();
    });
  });
  document.getElementById(`${calcId}-bal`)?.addEventListener("input", computeSize);
  computeSize();
}

// ─── Market Regime panel ───────────────────────────────────────────────────────
let regimeTimer = null;
async function fetchAndRenderRegime() {
  const el = document.getElementById("ep-regime-body");
  if (!el) return;
  try {
    const [klineRes, premRes] = await Promise.all([
      fetch("https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=4h&limit=60"),
      fetch("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT"),
    ]);
    const klines = await klineRes.json();
    const prem   = await premRes.json();
    const closes = klines.map(k => parseFloat(k[4]));
    function ema(data, period) {
      const k = 2 / (period + 1); let v = data[0];
      for (let i = 1; i < data.length; i++) v = data[i] * k + v * (1 - k);
      return v;
    }
    const ema20 = ema(closes, 20);
    const ema50 = ema(closes, 50);
    const price = closes[closes.length - 1];
    const fr    = parseFloat(prem.lastFundingRate || 0);
    const trend = ema20 > ema50 ? "bull" : "bear";
    const frAbs = Math.abs(fr * 100);
    const frSentiment = frAbs >= 0.08 ? (fr > 0 ? "Longs crowded — short bias" : "Shorts crowded — long bias")
      : frAbs >= 0.05 ? (fr > 0 ? "Longs extended" : "Shorts extended")
      : "Neutral";
    const frClass2 = frAbs >= 0.05 ? (fr > 0 ? "regime-val--red" : "regime-val--green") : "regime-val--neutral";
    const swings = closes.slice(-15).map((c, i, a) => i === 0 ? 0 : Math.abs(c - a[i-1]));
    const avgSwing = swings.reduce((a,b) => a+b,0)/swings.length;
    const regime = avgSwing / price * 100 > 0.8 ? "Trending" : "Ranging";

    el.innerHTML = `
      <div class="regime-row">
        <span class="regime-label">BTC 4H Trend</span>
        <span class="regime-val ${trend === "bull" ? "regime-val--green" : "regime-val--red"}">${trend === "bull" ? "▲ Bullish" : "▼ Bearish"}</span>
      </div>
      <div class="regime-row">
        <span class="regime-label">EMA20 vs EMA50</span>
        <span class="regime-val regime-val--neutral">${price.toFixed(0)} · EMA20 ${trend === "bull" ? ">" : "<"} EMA50</span>
      </div>
      <div class="regime-row">
        <span class="regime-label">Market regime</span>
        <span class="regime-val ${regime === "Trending" ? "regime-val--green" : "regime-val--amber"}">${regime}</span>
      </div>
      <div class="regime-row">
        <span class="regime-label">Funding rate</span>
        <span class="regime-val ${frClass2}">${(fr*100).toFixed(4)}%</span>
      </div>
      <div class="regime-row">
        <span class="regime-label">Sentiment</span>
        <span class="regime-val ${frClass2}">${frSentiment}</span>
      </div>
      <div class="regime-hint">${trend === "bull" ? "📈 Look for Long setups on pullbacks to EMA20 or key support" : "📉 Look for Short setups on rallies to EMA20 or key resistance"}</div>`;
  } catch {
    const el2 = document.getElementById("ep-regime-body");
    if (el2) el2.innerHTML = `<p class="regime-err">Could not load regime data</p>`;
  }
}

// ─── TF tab init ─────────────────────────────────────────────────────────────
function initChartTfTabs() {
  if (!dom.chartTfTabs) return;
  dom.chartTfTabs.addEventListener("click", async (e) => {
    const btn = e.target.closest(".chart-tf-tab");
    if (!btn) return;
    const tf = btn.dataset.tf;
    if (tf === activeChartTf) return;
    activeChartTf = tf;
    dom.chartTfTabs.querySelectorAll(".chart-tf-tab").forEach(b => b.classList.toggle("is-active", b === btn));
    if (activeChartSignal) await loadChartForTf(activeChartSignal, tf);
  });
}

async function loadChartForTf(signal, tf) {
  dom.chartContainer.innerHTML = '<p class="chart-empty">Loading…</p>';
  try {
    const data = await fetchBinanceKlines(signal.symbol, tf);
    data.pricePrecision = signal.pricePrecision;
    renderChart(data, signal);
  } catch (err) {
    dom.chartContainer.innerHTML = `<p class="chart-empty">Chart error: ${err.message}</p>`;
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
  activeChartSignal = signal;
  activeChartTf = "1h";
  if (dom.chartTfTabs) {
    dom.chartTfTabs.querySelectorAll(".chart-tf-tab").forEach(b => {
      b.classList.toggle("is-active", b.dataset.tf === "1h");
    });
  }
  const dir = signal.side === "Long" ? "▲" : "▼";
  dom.chartSymbol.textContent = `${signal.symbol} · ${dir} ${signal.side} · Q${signal.quality}`;
  renderReasoningPanel(signal);
  wirePosSizingCalc(signal);
  await loadChartForTf(signal, "1h");
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
  // Set activeChartSignal so TF tabs work after an Analyze search
  activeChartSignal = signal || {
    symbol: data.symbol,
    pricePrecision: data.pricePrecision || 4,
    entryPrice: data.currentPrice,
    sl: null, tp1: null, tp2: null,
  };
  activeChartTf = "1h";
  if (dom.chartTfTabs) {
    dom.chartTfTabs.querySelectorAll(".chart-tf-tab").forEach(b => {
      b.classList.toggle("is-active", b.dataset.tf === "1h");
    });
  }
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

let epEquityChart = null;

function renderEquityCurve() {
  const container = dom.equityChart;
  if (!container || typeof LightweightCharts === "undefined") return;
  const closedTrades = state.paper?.closedTrades || [];
  const startBal = state.paper?.startingBalance || 100;
  const points = computeEquityCurve(startBal, closedTrades);
  if (points.length < 2) {
    container.innerHTML = `<p class="equity-empty">Not enough closed trades to plot yet.</p>`;
    if (epEquityChart) { epEquityChart.remove(); epEquityChart = null; }
    return;
  }
  container.innerHTML = "";
  if (epEquityChart) { epEquityChart.remove(); epEquityChart = null; }
  epEquityChart = LightweightCharts.createChart(container, {
    height: 140,
    layout: { background: { color: "transparent" }, textColor: "#888" },
    grid: { vertLines: { visible: false }, horzLines: { color: "rgba(255,255,255,0.05)" } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false, timeVisible: true },
    handleScroll: false, handleScale: false,
  });
  const finalBalance = points[points.length - 1].value;
  const lineColor = finalBalance >= startBal ? "#4ade80" : "#f87171";
  const series = epEquityChart.addLineSeries({ color: lineColor, lineWidth: 2, priceLineVisible: false });
  series.setData(points);
  epEquityChart.timeScale().fitContent();
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

  // Pattern breakdown by signalType (EMA-specific)
  if (dom.statPTable) {
    const patternMeta = {
      A1: "EMA20 + S1",  A2: "EMA20 + S2",
      B1: "EMA50 + S1",  B2: "EMA50 + S2",
      C1: "Support 1",   C2: "Support 2",
      D1: "EMA20 + R1",  D2: "EMA20 + R2",
      E1: "EMA50 + R1",  E2: "EMA50 + R2",
      F1: "Resist 1",    F2: "Resist 2",
      G1: "EMA20 Retest ↓", G2: "EMA50 Retest ↓",
      H1: "EMA20 Pullback ↑", H2: "EMA50 Pullback ↑",
    };
    const patternOrder = ["B2","B1","A2","A1","E2","E1","D2","D1","C2","C1","F2","F1","G2","G1","H2","H1"];
    const rows = patternOrder.map(pt => {
      const sigs = alertedSigs.filter(s => s.signalType === pt);
      if (!sigs.length) return "";
      const res  = sigs.filter(s => s.outcome != null);
      const w    = res.filter(s => s.outcome === "TP1" || s.outcome === "TP2").length;
      const l    = res.filter(s => s.outcome === "SL").length;
      const wr   = res.length ? Math.round(w / res.length * 100) : null;
      return `<div class="perf-row">
        <span class="perf-row-label"><strong>${pt}</strong> <span class="perf-row-meta">${patternMeta[pt] || ""}</span></span>
        <span class="perf-row-count">${sigs.length}</span>
        <span class="perf-row-detail"><span class="tone-up">${w}W</span> / <span class="tone-down">${l}L</span></span>
        <span class="perf-row-wr ${wr == null ? "" : wr >= 50 ? "tone-up" : "tone-down"}">${wr != null ? `${wr}%` : "–"}</span>
      </div>`;
    }).filter(Boolean);
    dom.statPTable.innerHTML = rows.join("") || `<p class="perf-empty">No alerted signals yet.</p>`;
  }

  // Quality tier breakdown
  if (dom.statQTable) {
    const tiers = [
      { label: "Q75–79", min: 75, max: 79 },
      { label: "Q80–84", min: 80, max: 84 },
      { label: "Q85–89", min: 85, max: 89 },
      { label: "Q90+",   min: 90, max: 999 },
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
    const recent = resolved.slice().sort((a, b) => (b.alertedAt || 0) - (a.alertedAt || 0)).slice(0, 16);
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
          <span class="por-type">${s.signalType || ""}</span>
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
  initChartTfTabs();
  await fetchState();
  startPolling();
  fetchAndRenderRegime();
  regimeTimer = setInterval(fetchAndRenderRegime, 5 * 60 * 1000);
}

init();
