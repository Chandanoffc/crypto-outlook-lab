"use strict";
// EMA Perps frontend — EMA Signals Strategy

// ─── State ───────────────────────────────────────────────────────────────────
let state = { signals: [], lastScanAt: 0, alertDelivery: { discordWebhook: "", notifyOnNew: true } };
let currentTab = "active";
let activeChart = null;
let pollTimer = null;
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

// ─── Metrics ─────────────────────────────────────────────────────────────────
function renderMetrics() {
  const active = state.signals.filter(s => s.status === "active");
  const strong = active.filter(s => s.quality >= 80);
  const longs  = active.filter(s => s.side === "Long").length;
  const shorts = active.filter(s => s.side === "Short").length;
  const avgQ   = active.length
    ? Math.round(active.reduce((a, s) => a + s.quality, 0) / active.length)
    : null;

  dom.metricActive.textContent = active.length  || "–";
  dom.metricStrong.textContent = strong.length  || "–";
  dom.metricLongs.textContent  = longs  || "–";
  dom.metricShorts.textContent = shorts || "–";
  dom.metricAvgQ.textContent   = avgQ != null ? `Q${avgQ}` : "–";

  if (state.lastScanAt) {
    dom.metricScan.textContent = timeAgo(state.lastScanAt);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
/** Normalise S/R levels from either flat signal fields or nested levels object */
function sigLevels(signal) {
  if (!signal) return {};
  return signal.levels || { s1: signal.s1, s2: signal.s2, r1: signal.r1, r2: signal.r2 };
}

// ─── Signal feed ─────────────────────────────────────────────────────────────
function renderSignalCard(signal) {
  const isLong   = signal.side === "Long";
  const toneClass = isLong ? "tone-up" : "tone-down";
  const sideIcon  = isLong ? "▲" : "▼";
  const prec      = signal.pricePrecision || 2;
  const reason    = signal.signalLabel || signal.reasonLabels?.[0] || "";
  const lvls      = sigLevels(signal);

  return `
    <article class="signal-card signal-card--${isLong ? "long" : "short"}" data-symbol="${signal.symbol}" data-signal-id="${signal.id}" role="button" tabindex="0">
      <div class="signal-card-head">
        <div class="signal-card-symbol">
          <span class="signal-side-icon ${toneClass}">${sideIcon}</span>
          <strong>${signal.symbol}</strong>
          <span class="signal-interval">${signal.interval || "1h"}</span>
        </div>
        <div class="signal-card-quality ${qualityClass(signal.quality)}">
          <span class="quality-score">Q${signal.quality}</span>
          <span class="quality-label">${qualityLabel(signal.quality)}</span>
        </div>
      </div>

      <div class="signal-card-levels">
        <div class="level-row">
          <span class="level-label">Entry</span>
          <span class="level-value">${fp(signal.entryPrice, prec)}</span>
          <span class="level-meta">${reason}</span>
        </div>
        <div class="level-row">
          <span class="level-label">TP1</span>
          <span class="level-value tone-up">${fp(signal.tp1, prec)}</span>
          <span class="level-meta">${isLong ? "R1" : "S1"}</span>
        </div>
        <div class="level-row">
          <span class="level-label">TP2</span>
          <span class="level-value tone-up">${fp(signal.tp2, prec)}</span>
          <span class="level-meta">${isLong ? "R2" : "S2"}</span>
        </div>
        <div class="level-row">
          <span class="level-label">SL</span>
          <span class="level-value tone-down">${fp(signal.sl, prec)}</span>
        </div>
      </div>

      ${(lvls.s1 || lvls.r1) ? `
      <div class="signal-card-sr">
        ${lvls.s2 != null ? `<span class="sr-chip sr-s">S2 ${fp(lvls.s2, prec)}</span>` : ""}
        ${lvls.s1 != null ? `<span class="sr-chip sr-s">S1 ${fp(lvls.s1, prec)}</span>` : ""}
        ${lvls.r1 != null ? `<span class="sr-chip sr-r">R1 ${fp(lvls.r1, prec)}</span>` : ""}
        ${lvls.r2 != null ? `<span class="sr-chip sr-r">R2 ${fp(lvls.r2, prec)}</span>` : ""}
      </div>` : ""}

      <div class="signal-card-footer">
        <span class="signal-reasons">${(signal.reasonLabels || []).slice(0, 3).join(" · ")}</span>
        <span class="signal-time">${timeAgo(signal.detectedAt)}</span>
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
      active: "No active signals right now. Scanner runs every 5 minutes.",
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

    // Candlestick
    const candles = chart.addCandlestickSeries({
      upColor: "#22c55e", downColor: "#ef4444",
      borderUpColor: "#22c55e", borderDownColor: "#ef4444",
      wickUpColor: "#22c55e", wickDownColor: "#ef4444",
    });
    candles.setData(data.candles);

    // EMA20 — cyan
    if (data.ema20Series?.length > 1) {
      const l = chart.addLineSeries({ color: "#38bdf8", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
      l.setData(data.ema20Series);
    }

    // EMA50 — violet
    if (data.ema50Series?.length > 1) {
      const l = chart.addLineSeries({ color: "#a78bfa", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
      l.setData(data.ema50Series);
    }

    // S/R levels as horizontal price lines
    const lvls = sigLevels(signal) || data?.levels || {};
    const addSRLine = (price, color, title) => {
      if (!price || !isFinite(price)) return;
      candles.createPriceLine({ price, color, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: true, title });
    };
    addSRLine(lvls.s1, "#f59e0b", "S1");
    addSRLine(lvls.s2, "#ef4444", "S2");
    addSRLine(lvls.r1, "#34d399", "R1");
    addSRLine(lvls.r2, "#22c55e", "R2");

    // Signal levels
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
  const prec = signal?.pricePrecision || data?.pricePrecision || 2;
  const price = data?.currentPrice || signal?.entryPrice;
  const lvls  = sigLevels(signal) || data?.levels || {};

  dom.chartLevels.innerHTML = `
    <div class="levels-row">
      <span class="level-chip">Price <strong>${fp(price, prec)}</strong></span>
      <span class="level-chip">EMA20 <strong class="tone-cyan">${fp(data?.ema20, prec)}</strong></span>
      <span class="level-chip">EMA50 <strong class="tone-violet">${fp(data?.ema50, prec)}</strong></span>
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

  const prec     = data.pricePrecision || 2;
  const isUp     = data.trend === "up";
  const trendIcon  = isUp ? "▲" : "▼";
  const trendClass = isUp ? "tone-up" : "tone-down";
  const trendLabel = isUp ? "Uptrend (EMA20 > EMA50)" : "Downtrend (EMA50 > EMA20)";
  const signal   = data.signal;
  const lvls     = data.levels || sigLevels(signal);

  const qualChip = signal
    ? `<span class="analysis-quality ${qualityClass(signal.quality)}">Q${signal.quality} — ${qualityLabel(signal.quality)}</span>`
    : `<span class="analysis-quality quality-none">No active signal</span>`;

  dom.searchResult.innerHTML = `
    <div class="analysis-card">
      <div class="analysis-head">
        <div class="analysis-symbol">
          <strong>${data.symbol}</strong>
          <span class="${trendClass}">${trendIcon} ${trendLabel}</span>
          ${qualChip}
        </div>
        <div class="analysis-price">${fp(data.currentPrice, prec)}</div>
      </div>

      <div class="analysis-indicators">
        <div class="analysis-ind"><span>1H EMA20</span><strong class="tone-cyan">${fp(data.ema20, prec)}</strong></div>
        <div class="analysis-ind"><span>1H EMA50</span><strong class="tone-violet">${fp(data.ema50, prec)}</strong></div>
        <div class="analysis-ind"><span>RSI (14)</span><strong>${data.rsi ? Number(data.rsi).toFixed(1) : "–"}</strong></div>
        <div class="analysis-ind"><span>ATR</span><strong>${fp(data.atr, prec)}</strong></div>
        <div class="analysis-ind"><span>Support 1</span><strong class="tone-s1">${fp(lvls.s1, prec)}</strong></div>
        <div class="analysis-ind"><span>Support 2</span><strong class="tone-s2">${fp(lvls.s2, prec)}</strong></div>
        <div class="analysis-ind"><span>Resistance 1</span><strong class="tone-r1">${fp(lvls.r1, prec)}</strong></div>
        <div class="analysis-ind"><span>Resistance 2</span><strong class="tone-r2">${fp(lvls.r2, prec)}</strong></div>
        <div class="analysis-ind"><span>24H Change</span><strong class="${data.change24h >= 0 ? "tone-up" : "tone-down"}">${fPct(data.change24h)}</strong></div>
        <div class="analysis-ind"><span>Volume 24H</span><strong>$${data.volume24h ? (data.volume24h / 1_000_000).toFixed(0) + "M" : "–"}</strong></div>
      </div>

      ${signal ? `
        <div class="analysis-signal-block">
          <div class="analysis-signal-title">Signal: ${signal.side} · ${signal.signalLabel || signal.reasonLabels?.[0] || ""}</div>
          <div class="analysis-levels-row">
            <div class="level-chip-sm">Entry <strong>${fp(signal.entryPrice, prec)}</strong></div>
            <div class="level-chip-sm tp">TP1 ${fp(signal.tp1, prec)} <span class="level-meta">(${isUp ? "R1" : "S1"})</span></div>
            <div class="level-chip-sm tp">TP2 ${fp(signal.tp2, prec)} <span class="level-meta">(${isUp ? "R2" : "S2"})</span></div>
            <div class="level-chip-sm sl">SL ${fp(signal.sl, prec)}</div>
          </div>
        </div>` : `
        <div class="analysis-note">
          ${isUp
            ? `Price is in an uptrend. Looking for a pullback to EMA20/EMA50 or Support levels for a Long entry.`
            : `Price is in a downtrend. Looking for a bounce to EMA20/EMA50 or Resistance levels for a Short entry.`}
        </div>`}
    </div>`;

  // Render chart
  dom.chartSymbol.textContent = `${data.symbol} · EMA Perps Analysis`;
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
      dom.discordInput.value = state.alertDelivery.discordWebhook;
      dom.discordNotify.checked = state.alertDelivery.notifyOnNew !== false;
    }
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

// ─── Event wiring ────────────────────────────────────────────────────────────
dom.searchBtn.addEventListener("click", doSearch);
dom.searchInput.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });
dom.scanBtn.addEventListener("click", triggerScan);
dom.discordSave.addEventListener("click", saveDiscord);

document.querySelectorAll("[data-ep-tab]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-ep-tab]").forEach(b => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    currentTab = btn.dataset.epTab;
    renderFeed();
  });
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
