"use strict";
// Claudeperps frontend — Multi-Timeframe Momentum Confluence strategy

// ─── State ───────────────────────────────────────────────────────────────────
let state = { signals: [], lastScanAt: 0, alertDelivery: { discordWebhook: "", notifyOnNew: true } };
let currentTab = "active";
let activeChart = null;
let activeChartSymbol = null;
let pollTimer = null;
const POLL_INTERVAL_MS = 30_000;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const dom = {
  statusDot:     document.getElementById("cp-status-dot"),
  statusMsg:     document.getElementById("cp-status-msg"),
  lastScan:      document.getElementById("cp-last-scan"),
  searchInput:   document.getElementById("cp-search-input"),
  searchBtn:     document.getElementById("cp-search-btn"),
  scanBtn:       document.getElementById("cp-scan-btn"),
  searchResult:  document.getElementById("cp-search-result"),
  signalFeed:    document.getElementById("cp-signal-feed"),
  chartContainer: document.getElementById("cp-chart-container"),
  chartSymbol:   document.getElementById("cp-chart-symbol"),
  chartLevels:   document.getElementById("cp-chart-levels"),
  discordInput:  document.getElementById("cp-discord-input"),
  discordNotify: document.getElementById("cp-discord-notify"),
  discordSave:   document.getElementById("cp-discord-save"),
  discordNote:   document.getElementById("cp-discord-note"),
  metricActive:  document.getElementById("cp-metric-active"),
  metricToday:   document.getElementById("cp-metric-today"),
  metricLongs:   document.getElementById("cp-metric-longs"),
  metricShorts:  document.getElementById("cp-metric-shorts"),
  metricAvgQ:    document.getElementById("cp-metric-avgq"),
  metricScan:    document.getElementById("cp-metric-scan"),
  metricScanNote: document.getElementById("cp-metric-scan-note"),
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

  dom.metricActive.textContent = active.length || "–";
  dom.metricToday.textContent = today.length || "–";
  dom.metricLongs.textContent = longs || "–";
  dom.metricShorts.textContent = shorts || "–";
  dom.metricAvgQ.textContent = avgQ != null ? `Q${avgQ}` : "–";

  if (state.lastScanAt) {
    dom.metricScan.textContent = timeAgo(state.lastScanAt);
  }
}

// ─── Signal feed ─────────────────────────────────────────────────────────────
function renderSignalCard(signal) {
  const isLong = signal.side === "Long";
  const toneClass = isLong ? "tone-up" : "tone-down";
  const sideIcon = isLong ? "▲" : "▼";
  const prec = signal.pricePrecision || 2;
  const reasons = (signal.reasonLabels || []).slice(0, 4).join(" · ");
  return `
    <article class="signal-card signal-card--${isLong ? "long" : "short"}" data-symbol="${signal.symbol}" data-signal-id="${signal.id}" role="button" tabindex="0">
      <div class="signal-card-head">
        <div class="signal-card-symbol">
          <span class="signal-side-icon ${toneClass}">${sideIcon}</span>
          <strong>${signal.symbol}</strong>
          <span class="signal-interval">${signal.interval}</span>
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
        </div>
        <div class="level-row">
          <span class="level-label">TP1</span>
          <span class="level-value tone-up">${fp(signal.tp1, prec)}</span>
          <span class="level-rr">1.5:1</span>
        </div>
        <div class="level-row">
          <span class="level-label">TP2</span>
          <span class="level-value tone-up">${fp(signal.tp2, prec)}</span>
          <span class="level-rr">2.5:1</span>
        </div>
        <div class="level-row">
          <span class="level-label">SL</span>
          <span class="level-value tone-down">${fp(signal.sl, prec)}</span>
        </div>
      </div>

      <div class="signal-card-footer">
        <span class="signal-reasons">${reasons}</span>
        <span class="signal-time">${timeAgo(signal.detectedAt)}</span>
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
      <p>${currentTab === "active" ? "No active signals right now. Scanner runs every 5 minutes." : "No signals in the last 24 hours."}</p>
    </div>`;
    return;
  }
  dom.signalFeed.innerHTML = filtered.map(renderSignalCard).join("");

  // Click to chart
  dom.signalFeed.querySelectorAll(".signal-card").forEach(card => {
    card.addEventListener("click", () => {
      const signalId = card.dataset.signalId;
      const signal = state.signals.find(s => s.id === signalId);
      if (signal) openChartForSignal(signal);
    });
    card.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        const signalId = card.dataset.signalId;
        const signal = state.signals.find(s => s.id === signalId);
        if (signal) openChartForSignal(signal);
      }
    });
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

    // Candlestick series
    const candles = chart.addCandlestickSeries({
      upColor: "#22c55e", downColor: "#ef4444",
      borderUpColor: "#22c55e", borderDownColor: "#ef4444",
      wickUpColor: "#22c55e", wickDownColor: "#ef4444",
    });
    candles.setData(data.candles);

    // EMA20
    if (data.ema20Series?.length > 1) {
      const ema20 = chart.addLineSeries({ color: "#38bdf8", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
      ema20.setData(data.ema20Series);
    }

    // EMA50
    if (data.ema50Series?.length > 1) {
      const ema50 = chart.addLineSeries({ color: "#a78bfa", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
      ema50.setData(data.ema50Series);
    }

    // Signal levels as price lines
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

    // Levels row
    if (signal) renderLevelsRow(signal, data);
  } catch (err) {
    container.innerHTML = `<p class="chart-empty">Chart error: ${err.message}</p>`;
  }
}

function renderLevelsRow(signal, data) {
  const prec = signal?.pricePrecision || 2;
  const price = data?.currentPrice || signal?.entryPrice;
  dom.chartLevels.innerHTML = `
    <div class="levels-row">
      <span class="level-chip">Price <strong>${fp(price, prec)}</strong></span>
      <span class="level-chip">EMA20 <strong class="tone-cyan">${fp(data?.ema20, prec)}</strong></span>
      <span class="level-chip">EMA50 <strong class="tone-violet">${fp(data?.ema50, prec)}</strong></span>
      ${signal ? `<span class="level-chip">TP1 <strong class="tone-up">${fp(signal.tp1, prec)}</strong></span>` : ""}
      ${signal ? `<span class="level-chip">TP2 <strong class="tone-up">${fp(signal.tp2, prec)}</strong></span>` : ""}
      ${signal ? `<span class="level-chip">SL <strong class="tone-down">${fp(signal.sl, prec)}</strong></span>` : ""}
      ${signal ? `<span class="level-chip">ATR <strong>${fp(signal.atr, prec)}</strong></span>` : ""}
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
  const trendIcon = data.structureBias === "up" ? "▲" : "▼";
  const trendClass = data.structureBias === "up" ? "tone-up" : "tone-down";
  const trendLabel = data.structureBias === "up" ? "Bullish" : "Bearish";
  const signal = data.signal;
  const qualChip = signal
    ? `<span class="analysis-quality ${qualityClass(signal.quality)}">Q${signal.quality} — ${qualityLabel(signal.quality)}</span>`
    : `<span class="analysis-quality quality-none">No active signal (Q${data.analysisQuality})</span>`;

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
        <div class="analysis-ind"><span>4H EMA20</span><strong>${data.ema20_4h ? fp(data.ema20_4h, prec) : "–"}</strong></div>
        <div class="analysis-ind"><span>4H EMA50</span><strong>${data.ema50_4h ? fp(data.ema50_4h, prec) : "–"}</strong></div>
        <div class="analysis-ind"><span>RSI (14)</span><strong>${data.rsi ? Number(data.rsi).toFixed(1) : "–"}</strong></div>
        <div class="analysis-ind"><span>MACD hist</span><strong>${data.macd?.hist != null ? Number(data.macd.hist).toFixed(4) : "–"}</strong></div>
        <div class="analysis-ind"><span>ATR</span><strong>${fp(data.atr, prec)}</strong></div>
        <div class="analysis-ind"><span>Funding</span><strong>${data.fundingRate != null ? fPct(data.fundingRate, 4) : "–"}</strong></div>
        <div class="analysis-ind"><span>24H Change</span><strong class="${data.change24h >= 0 ? "tone-up" : "tone-down"}">${fPct(data.change24h)}</strong></div>
        <div class="analysis-ind"><span>Volume 24H</span><strong>$${data.volume24h ? (data.volume24h / 1_000_000).toFixed(0) + "M" : "–"}</strong></div>
      </div>

      ${signal ? `
        <div class="analysis-signal-block">
          <div class="analysis-signal-title">Active Signal: ${signal.side} · ${signal.reasonLabels?.slice(0,3).join(" · ")}</div>
          <div class="analysis-levels-row">
            <div class="level-chip-sm">Entry <strong>${fp(signal.entryPrice, prec)}</strong></div>
            <div class="level-chip-sm tp">TP1 ${fp(signal.tp1, prec)}</div>
            <div class="level-chip-sm tp">TP2 ${fp(signal.tp2, prec)}</div>
            <div class="level-chip-sm sl">SL ${fp(signal.sl, prec)}</div>
          </div>
        </div>` : ""}
    </div>`;

  // Render chart inline with analysis
  dom.chartSymbol.textContent = `${data.symbol} · Claudeperps Analysis`;
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
  } catch (err) {
    setStatus(`Scan failed: ${err.message}`, "down");
  } finally {
    dom.scanBtn.disabled = false;
    dom.scanBtn.textContent = "Run Scanner";
  }
}

async function saveDiscord() {
  const webhook = dom.discordInput.value.trim();
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

// ─── Event wiring ────────────────────────────────────────────────────────────
dom.searchBtn.addEventListener("click", doSearch);
dom.searchInput.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });
dom.scanBtn.addEventListener("click", triggerScan);
dom.discordSave.addEventListener("click", saveDiscord);

document.querySelectorAll("[data-cp-tab]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-cp-tab]").forEach(b => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    currentTab = btn.dataset.cpTab;
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
