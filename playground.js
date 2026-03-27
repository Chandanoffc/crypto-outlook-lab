const TABS = ["Funding Rates", "EMA / RSI Filter", "DLMM Alerts", "Combined Strategy"];
const ASSETS = ["BTC", "ETH", "SOL"];

const MOCK_FUNDING = {
  BTC: { rate: 0.0082, history: [0.0075, 0.0091, 0.0068, 0.0077, 0.0083, 0.0079, 0.0088, 0.0072] },
  ETH: { rate: 0.0061, history: [0.0058, 0.0049, 0.0063, 0.0071, 0.0055, 0.0062, 0.0047, 0.0058] },
  SOL: { rate: 0.0124, history: [0.0098, 0.0115, 0.0131, 0.0108, 0.0119, 0.0127, 0.0103, 0.0121] },
};

const PRICE_DATA = {
  BTC: [84000,84200,83800,84500,85000,84700,85200,85800,86000,85500,85200,84800,84500,84200,84000,83800,83500,83200,83000,82800,83200,83800,84200,84800,85200,85600,86000,86400,86800,87000,86800,86500,86200,86000,85800,85500,85200,85000,84800,84500,84200,84000,83800,84200,84800,85200,85800,86200,86800,87200,87600,88000,88400,88800,89000,88800,88500,88200,88000,87800,87500,87200,87000,86800,86500,86200,86000,85800,85500,85200,85000,84800,84500,84200,84000,84200,84500,84800,85200,85600,86000,86400,86800,87000,87200,87500,87800,88000,88200,88500,88800,89000,89200,89500,89800,90000,90200,90500,90800,91000,90800,90500,90200,90000,89800,89500,89200,89000,88800,88500,88200,88000,87800,87500,87200,87000,86800,86500,86200,86000,85800,85500,85200,85000,84800,84500,84200,84000,84200,84500,84800,85200,85600,86000,86400,86800,87000,87200,87500,87800,88000,88200,88500,88800,89000,89200,89500,89800,90000,90200,90500,90800,91000,91200,91500,91800,92000,92200,92500,92800,93000,93200,93500,93800,94000,93800,93500,93200,93000,92800,92500,92200,92000,91800,91500,91200,91000,90800,90500,90200,90000,89800,89500,89200,89000,88800,88500,88200,88000,87800,87500,87200,87000,86800,86500,86200,86000,85800,85500,85200,85000,84800,84500,84200,84000,83800,83500,83200,83000],
  ETH: [1950,1960,1940,1970,1990,1980,2000,2020,2030,2010,2000,1990,1980,1970,1960,1950,1940,1930,1920,1910,1920,1940,1960,1980,2000,2020,2040,2060,2080,2090,2080,2070,2060,2050,2040,2030,2020,2010,2000,1990,1980,1970,1960,1980,2000,2020,2040,2060,2080,2100,2120,2140,2160,2180,2190,2180,2170,2160,2150,2140,2130,2120,2110,2100,2090,2080,2070,2060,2050,2040,2030,2020,2010,2000,1990,2000,2010,2020,2040,2060,2080,2100,2120,2140,2160,2180,2200,2220,2240,2260,2280,2300,2320,2340,2360,2380,2400,2420,2440,2460,2440,2420,2400,2380,2360,2340,2320,2300,2280,2260,2240,2220,2200,2180,2160,2140,2120,2100,2080,2060,2040,2020,2000,1990,1980,1970,1960,1950,2000,2020,2040,2060,2080,2100,2120,2140,2160,2180,2200,2220,2240,2260,2280,2300,2320,2340,2360,2380,2400,2420,2440,2460,2480,2500,2520,2540,2560,2580,2600,2620,2640,2660,2680,2700,2720,2700,2680,2660,2640,2620,2600,2580,2560,2540,2520,2500,2480,2460,2440,2420,2400,2380,2360,2340,2320,2300,2280,2260,2240,2220,2200,2180,2160,2140,2120,2100,2080,2060,2040,2020,2000,1980,1960,1940,1920,1900,1880,1860,1840],
  SOL: [128,129,127,130,132,131,133,135,136,134,133,132,131,130,129,128,127,126,125,124,125,127,129,131,133,135,137,139,141,142,141,140,139,138,137,136,135,134,133,132,131,130,129,131,133,135,137,139,141,143,145,147,149,151,152,151,150,149,148,147,146,145,144,143,142,141,140,139,138,137,136,135,134,133,132,133,134,136,138,140,142,144,146,148,150,152,154,156,158,160,162,164,166,168,170,172,174,176,178,180,178,176,174,172,170,168,166,164,162,160,158,156,154,152,150,148,146,144,142,140,138,136,134,132,130,128,126,124,126,128,130,132,134,136,138,140,142,144,146,148,150,152,154,156,158,160,162,164,166,168,170,172,174,176,178,180,182,184,186,188,190,192,194,196,198,200,198,196,194,192,190,188,186,184,182,180,178,176,174,172,170,168,166,164,162,160,158,156,154,152,150,148,146,144,142,140,138,136,134,132,130,128,126,124,122,120,118,116,114],
};

const state = {
  activeTab: 0,
  alertThreshold: 0.06,
  alertsEnabled: false,
  selectedAsset: "SOL",
  dlmmPositions: [
    { id: 1, pair: "SOL/USDC", entryPrice: 148, currentPrice: 164, rangePct: 15, shape: "Curve" },
    { id: 2, pair: "BTC/USDC", entryPrice: 87000, currentPrice: 85000, rangePct: 12, shape: "Spot" },
  ],
  newPos: { pair: "", entryPrice: "", currentPrice: "", rangePct: 15, shape: "Curve" },
  priceInputs: {},
};

function calcEMA(prices, period) {
  if (!prices || prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i += 1) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcRSI(prices, period = 14) {
  if (!prices || prices.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const d = prices[i] - prices[i - 1];
    if (d > 0) gains += d;
    else losses -= d;
  }
  let ag = gains / period;
  let al = losses / period;
  for (let i = period + 1; i < prices.length; i += 1) {
    const d = prices[i] - prices[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

function calcVolatility(prices) {
  if (!prices || prices.length < 20) return 0;
  const recent = prices.slice(-20);
  const returns = recent.slice(1).map((price, i) => Math.log(price / recent[i]));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(6) * 100;
}

function number(value, maximumFractionDigits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return value.toLocaleString(undefined, { maximumFractionDigits });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getToneClass(signal) {
  if (["LONG", "LONG BIAS", "bullish", "strong-arb", "oversold"].includes(signal)) return "is-green";
  if (["SHORT", "SHORT BIAS", "bearish", "short-arb", "overbought"].includes(signal)) return "is-red";
  if (["arb", "warning", "rising"].includes(signal)) return "is-amber";
  return "is-muted";
}

function getStatusLabel(status) {
  return {
    safe: "SAFE",
    warning: "REBALANCE SOON",
    danger: "DANGER",
    out: "OUT OF RANGE",
  }[status];
}

function getStatusClass(status) {
  return {
    safe: "is-safe",
    warning: "is-warning",
    danger: "is-danger",
    out: "is-danger",
  }[status] || "";
}

function getDerivedState() {
  const fundingSignals = Object.entries(MOCK_FUNDING).map(([asset, data]) => {
    const { rate, history } = data;
    const annualized = rate * 3 * 365 * 100;
    const avgRate = history.reduce((a, b) => a + b, 0) / history.length;
    const trend = rate > avgRate ? "rising" : "falling";
    const threshold = state.alertThreshold / 100;
    let signal = "neutral";
    if (rate < 0) signal = "short-arb";
    else if (rate > threshold * 1.5) signal = "strong-arb";
    else if (rate > threshold) signal = "arb";
    return { asset, rate, annualized, avgRate, trend, signal, history };
  });

  const prices = PRICE_DATA[state.selectedAsset];
  const ema50 = calcEMA(prices, 50);
  const ema200 = calcEMA(prices, 200);
  const rsi = calcRSI(prices);
  const currentPrice = prices[prices.length - 1];
  const volatility = calcVolatility(prices);

  const emaSignal = ema50 && ema200 ? (ema50 > ema200 ? "bullish" : "bearish") : "neutral";
  const rsiZone = !rsi ? "neutral" : rsi < 40 ? "oversold" : rsi > 70 ? "overbought" : "neutral";
  let trendSignal = "NEUTRAL";
  if (emaSignal === "bullish" && rsiZone !== "overbought") trendSignal = "LONG";
  if (emaSignal === "bearish" && rsiZone !== "oversold") trendSignal = "SHORT";

  const dlmmAlerts = state.dlmmPositions.map((position) => {
    const high = position.entryPrice * (1 + position.rangePct / 100);
    const low = position.entryPrice * (1 - position.rangePct / 100);
    const span = high - low;
    const rawPct = ((position.currentPrice - low) / span) * 100;
    const distToEdge = Math.min(
      (Math.abs(position.currentPrice - high) / span) * 100,
      (Math.abs(position.currentPrice - low) / span) * 100
    );
    let status = "safe";
    if (rawPct < 0 || rawPct > 100) status = "out";
    else if (distToEdge < 10) status = "danger";
    else if (distToEdge < 20) status = "warning";
    return {
      ...position,
      high,
      low,
      pct: Math.max(0, Math.min(100, rawPct)),
      distToEdge,
      status,
    };
  });

  const fundSelected = MOCK_FUNDING[state.selectedAsset]?.rate ?? 0;
  const perpsCombined = (() => {
    let longScore = 0;
    let shortScore = 0;
    if (emaSignal === "bullish") longScore += 2;
    if (emaSignal === "bearish") shortScore += 2;
    if (rsi && rsi < 40) longScore += 1;
    if (rsi && rsi > 72) shortScore += 1;
    if (fundSelected > 0.01) shortScore += 1;

    if (longScore > shortScore) {
      return {
        signal: "LONG BIAS",
        strength: longScore,
        reason: `EMA cross bullish. RSI at ${rsi?.toFixed(1)} is not overbought${fundSelected < 0.01 ? " and funding remains healthy." : ", but funding is elevated so size down."}`,
      };
    }
    if (shortScore > longScore) {
      return {
        signal: "SHORT BIAS",
        strength: shortScore,
        reason: `EMA cross bearish. RSI at ${rsi?.toFixed(1)} is not oversold${fundSelected > 0.01 ? ", and positive funding improves the short carry." : "."}`,
      };
    }
    return {
      signal: "NEUTRAL",
      strength: 0,
      reason: "Signals conflict here. No high-conviction directional setup, so a delta-neutral funding approach may be cleaner.",
    };
  })();

  const dlmmRec = (() => {
    if (volatility < 2) return { shape: "Curve", range: "±8%", action: "Tight bell curve. Low volatility keeps liquidity active most of the time." };
    if (volatility < 4) return { shape: "Spot", range: "±15%", action: "Uniform spread. Moderate volatility argues for a wider range and fewer rebalances." };
    return { shape: "Bid-Ask", range: "±25%", action: "Edge-weighted. High volatility means more active management, but fee spikes are better at the edges." };
  })();

  return {
    fundingSignals,
    prices,
    ema50,
    ema200,
    rsi,
    currentPrice,
    volatility,
    emaSignal,
    rsiZone,
    trendSignal,
    dlmmAlerts,
    perpsCombined,
    dlmmRec,
    fundSelected,
  };
}

function renderFundingTab(derived) {
  return `
    <div class="playground-panel-stack">
      <div class="playground-control-row">
        <span class="playground-label">Alert threshold</span>
        <input id="playground-alert-threshold" class="playground-input playground-input--compact" type="number" min="0.01" step="0.01" value="${state.alertThreshold}" />
        <span class="playground-inline-note">% / 8h</span>
        <span class="playground-dim-note">= ${(state.alertThreshold * 3 * 365).toFixed(0)}% annualized</span>
      </div>

      <div class="playground-card-grid">
        ${derived.fundingSignals
          .map((item) => {
            const badge =
              item.signal === "strong-arb"
                ? "STRONG ARB"
                : item.signal === "arb"
                  ? "ARB OPP"
                  : item.signal === "short-arb"
                    ? "SHORT ARB"
                    : "NEUTRAL";
            const histBars = item.history
              .map((rate, index) => {
                const height = Math.min(100, (rate / 0.02) * 100);
                const tone = rate > state.alertThreshold / 100 ? "var(--playground-green)" : "rgba(148, 163, 184, 0.34)";
                const opacity = 0.6 + (index / item.history.length) * 0.4;
                return `<div class="playground-hist-bar" style="height:${height}%;background:${tone};opacity:${opacity};" title="${(rate * 100).toFixed(4)}%"></div>`;
              })
              .join("");

            return `
              <article class="playground-card${item.signal === "strong-arb" ? " is-hot" : ""}">
                <div class="playground-card-top">
                  <span class="playground-asset-title">${item.asset} <small>PERP</small></span>
                  <span class="playground-pill ${getToneClass(item.signal)}">${badge}</span>
                </div>
                <div class="playground-rate-line">
                  <strong class="${getToneClass(item.signal)}">${item.rate < 0 ? "" : "+"}${(item.rate * 100).toFixed(4)}%</strong>
                  <span>per 8h</span>
                </div>
                <div class="playground-meta-row">
                  <span>${item.annualized.toFixed(1)}% ann.</span>
                  <span class="${item.trend === "rising" ? "is-green" : "is-red"}">${item.trend === "rising" ? "↑" : "↓"} ${item.trend}</span>
                </div>
                <div class="playground-hist-wrap">${histBars}</div>
                ${
                  item.signal === "strong-arb" || item.signal === "arb"
                    ? `<div class="playground-note-card">Short ${item.asset} perp and long ${item.asset} spot to collect ${(item.rate * 100).toFixed(4)}% every 8h while staying delta-neutral.</div>`
                    : item.signal === "short-arb"
                      ? `<div class="playground-note-card">Long ${item.asset} perp and short ${item.asset} spot to collect negative funding.</div>`
                      : ""
                }
              </article>
            `;
          })
          .join("")}
      </div>

      <div class="playground-api-note">
        <span>Data</span>
        Replace the mock funding dataset with Coinglass or Binance funding endpoints when you want to move this lab from sandbox to live feed.
      </div>
    </div>
  `;
}

function renderEmaTab(derived) {
  const metrics = [
    { label: "Price (4H close)", value: `$${number(derived.currentPrice, 2)}`, cls: "" },
    { label: "EMA 50 (4H)", value: `$${number(derived.ema50, 2)}`, cls: "" },
    { label: "EMA 200 (4H)", value: `$${number(derived.ema200, 2)}`, cls: "" },
    { label: "EMA cross", value: derived.emaSignal.toUpperCase(), cls: getToneClass(derived.emaSignal) },
    { label: "RSI (14, 4H)", value: derived.rsi ? derived.rsi.toFixed(1) : "-", cls: getToneClass(derived.rsiZone) },
    { label: "RSI zone", value: derived.rsiZone.toUpperCase(), cls: getToneClass(derived.rsiZone) },
  ];

  let ruleItems = [];
  if (derived.trendSignal === "LONG") {
    ruleItems = [
      "Wait for a 1H candle to pull back into the 20 EMA.",
      "Confirm 1H RSI is bouncing from the 40 to 50 zone.",
      "Enter long on the close of that reclaim candle.",
      "Place the stop just below the latest 1H swing low.",
      "Take 50% at 1.5R and trail the rest toward 3R.",
      `Use 3x to 5x max leverage${derived.fundSelected > 0.01 ? ", but cut to 2x if funding remains elevated." : "."}`,
    ];
  } else if (derived.trendSignal === "SHORT") {
    ruleItems = [
      "Wait for price to retest broken support as new resistance on 1H.",
      "Confirm a rejection candle with RSI failing near 50 to 60.",
      "Enter short on the close of that rejection candle.",
      "Place the stop above the retest wick high.",
      "Take 50% at 1.5R and trail the remainder toward 3R.",
      "Positive funding helps the short carry, but still keep leverage disciplined.",
    ];
  } else {
    ruleItems = [
      "No directional trade here. Stay flat or cut size aggressively.",
      `Run a delta-neutral funding approach instead: short ${state.selectedAsset} perp and long spot.`,
      `Collect ${(derived.fundSelected * 100).toFixed(4)}% every 8h while directional conviction is unclear.`,
      "Re-check after the next 4H close for cleaner structure.",
    ];
  }

  return `
    <div class="playground-panel-stack">
      <section class="playground-signal-hero">
        <div class="playground-signal-value ${getToneClass(derived.trendSignal)}">${derived.trendSignal}</div>
        <p class="playground-signal-copy">
          ${
            derived.trendSignal === "LONG"
              ? `EMA50 is above EMA200 for ${state.selectedAsset}, with RSI at ${derived.rsi?.toFixed(1)} and not yet overbought. Favor pullback continuation entries.`
              : derived.trendSignal === "SHORT"
                ? `EMA50 is below EMA200 for ${state.selectedAsset}, with RSI at ${derived.rsi?.toFixed(1)} and not yet oversold. Favor rejection-based short continuations.`
                : `EMA and RSI are conflicting on ${state.selectedAsset}. This is better treated as a watchlist or funding-arb environment.`
          }
        </p>
      </section>

      <div class="playground-metric-grid">
        ${metrics
          .map(
            (metric) => `
              <article class="playground-metric-card">
                <span class="playground-metric-label">${metric.label}</span>
                <strong class="${metric.cls}">${metric.value}</strong>
              </article>
            `
          )
          .join("")}
      </div>

      <section class="playground-rsi-card">
        <div class="playground-rsi-title">RSI (14) on 4H candles</div>
        <div class="playground-rsi-track">
          <div class="playground-rsi-zone is-low"></div>
          <div class="playground-rsi-zone is-high"></div>
          <div class="playground-rsi-dot" style="left:${Math.min(99, Math.max(1, derived.rsi ?? 50))}%"></div>
        </div>
        <div class="playground-rsi-ticks">
          <span>0</span>
          <span>30 oversold</span>
          <span>50</span>
          <span>70 overbought</span>
          <span>100</span>
        </div>
      </section>

      <section class="playground-rule-card">
        <div class="playground-rule-title">${derived.trendSignal} execution rules for ${state.selectedAsset}</div>
        <ol class="playground-rule-list">
          ${ruleItems.map((item) => `<li>${item}</li>`).join("")}
        </ol>
      </section>

      <div class="playground-api-note">
        <span>Data</span>
        Replace the seeded price array with your live 4H kline feed when you want the trend model to update from market data instead of static sandbox prices.
      </div>
    </div>
  `;
}

function renderDlmmTab(derived) {
  const cards =
    derived.dlmmAlerts.length === 0
      ? `<div class="playground-empty-state">No positions yet. Add one below.</div>`
      : derived.dlmmAlerts
          .map(
            (position) => `
              <article class="playground-position-card ${getStatusClass(position.status)}">
                <div class="playground-position-head">
                  <div>
                    <div class="playground-position-pair">${escapeHtml(position.pair)}</div>
                    <div class="playground-position-shape">${escapeHtml(position.shape)} · ±${position.rangePct}%</div>
                  </div>
                  <div class="playground-position-actions">
                    <span class="playground-pill ${getStatusClass(position.status)}">${getStatusLabel(position.status)}</span>
                    <button class="playground-icon-button" type="button" data-remove-position="${position.id}">×</button>
                  </div>
                </div>

                <div class="playground-range-wrap">
                  <div class="playground-range-track">
                    <div class="playground-range-danger is-left"></div>
                    <div class="playground-range-danger is-right"></div>
                    <div class="playground-range-thumb ${getStatusClass(position.status)}" style="left:${position.pct}%"></div>
                  </div>
                  <div class="playground-range-labels">
                    <span>Low $${number(position.low, 0)}</span>
                    <span>Entry $${number(position.entryPrice, 0)}</span>
                    <span>High $${number(position.high, 0)}</span>
                  </div>
                </div>

                <div class="playground-position-meta">
                  <div>
                    <span>Current price</span>
                    <strong>$${number(position.currentPrice, 2)}</strong>
                  </div>
                  <div>
                    <span>Position in range</span>
                    <strong>${position.pct.toFixed(1)}%</strong>
                  </div>
                  <div>
                    <span>Distance to edge</span>
                    <strong class="${position.distToEdge < 15 ? "is-red" : ""}">${position.distToEdge.toFixed(1)}%</strong>
                  </div>
                </div>

                ${
                  position.status !== "safe"
                    ? `<div class="playground-alert-copy">${
                        position.status === "out"
                          ? "Position is out of range. Liquidity is inactive and fees are no longer compounding."
                          : position.status === "danger"
                            ? `Only ${position.distToEdge.toFixed(1)}% from the range edge. Rebalance quickly to stay active.`
                            : `Price is ${position.distToEdge.toFixed(1)}% from the range edge. Prepare a rebalance soon.`
                      }</div>`
                    : ""
                }

                <div class="playground-control-row">
                  <span class="playground-label">Update price</span>
                  <input class="playground-input playground-input--compact" type="number" data-price-input="${position.id}" value="${state.priceInputs[position.id] ?? ""}" placeholder="${position.currentPrice}" />
                  <button class="playground-secondary-button" type="button" data-apply-price="${position.id}">Apply</button>
                </div>
              </article>
            `
          )
          .join("");

  return `
    <div class="playground-panel-stack">
      ${cards}

      <section class="playground-add-card">
        <div class="playground-add-title">Add position</div>
        <div class="playground-form-grid">
          <input id="playground-new-pair" class="playground-input" type="text" placeholder="Pair e.g. SOL/USDC" value="${escapeHtml(state.newPos.pair)}" />
          <input id="playground-new-entry" class="playground-input" type="number" placeholder="Entry price" value="${escapeHtml(state.newPos.entryPrice)}" />
          <input id="playground-new-current" class="playground-input" type="number" placeholder="Current price" value="${escapeHtml(state.newPos.currentPrice)}" />
          <select id="playground-new-shape" class="playground-input">
            <option${state.newPos.shape === "Curve" ? " selected" : ""}>Curve</option>
            <option${state.newPos.shape === "Spot" ? " selected" : ""}>Spot</option>
            <option${state.newPos.shape === "Bid-Ask" ? " selected" : ""}>Bid-Ask</option>
          </select>
          <div class="playground-range-field">
            <input id="playground-new-range" class="playground-input playground-input--compact" type="number" value="${escapeHtml(state.newPos.rangePct)}" />
            <span class="playground-inline-note">% range</span>
          </div>
          <button id="playground-add-position" class="playground-primary-button" type="button">Add position</button>
        </div>
      </section>
    </div>
  `;
}

function renderCombinedTab(derived) {
  const flowRange = Number(derived.dlmmRec.range.replace("±", "").replace("%", ""));
  return `
    <div class="playground-combined-grid">
      <article class="playground-combined-card">
        <div class="playground-combined-label">Perps signal — ${state.selectedAsset}</div>
        <div class="playground-combined-signal ${getToneClass(derived.perpsCombined.signal)}">${derived.perpsCombined.signal}</div>
        <p class="playground-combined-copy">${derived.perpsCombined.reason}</p>

        <div class="playground-checklist">
          <div class="playground-check-row">
            <span class="${derived.emaSignal === "bullish" ? "is-green" : "is-red"}">${derived.emaSignal === "bullish" ? "✓" : "✗"}</span>
            <span>EMA 50/200: <strong>${derived.emaSignal}</strong></span>
          </div>
          <div class="playground-check-row">
            <span class="${derived.rsiZone !== "overbought" ? "is-green" : "is-red"}">${derived.rsiZone !== "overbought" ? "✓" : "✗"}</span>
            <span>RSI: <strong>${derived.rsiZone}</strong> (${derived.rsi?.toFixed(1) ?? "-"})</span>
          </div>
          <div class="playground-check-row">
            <span class="${derived.fundSelected < 0.008 ? "is-green" : "is-amber"}">${derived.fundSelected < 0.008 ? "✓" : "!"}</span>
            <span>Funding: <strong>${(derived.fundSelected * 100).toFixed(4)}%</strong>${derived.fundSelected > 0.01 ? " — longs are crowded." : ""}</span>
          </div>
        </div>

        <div class="playground-note-card">
          <strong>Execution plan</strong>
          <ol class="playground-rule-list">
            ${
              derived.perpsCombined.signal === "LONG BIAS"
                ? `
                  <li>Set a limit entry about 0.3% below the 1H 20 EMA.</li>
                  <li>Use the latest 1H swing low as invalidation.</li>
                  <li>Scale out at 1.5R and 3R.</li>
                  <li>Keep leverage at 3x unless funding stays elevated.</li>
                `
                : derived.perpsCombined.signal === "SHORT BIAS"
                  ? `
                    <li>Sell a 1H retest into failed support turned resistance.</li>
                    <li>Use the rejection wick high as the stop anchor.</li>
                    <li>Scale out at 1.5R and 3R.</li>
                    <li>Positive funding improves the short carry profile.</li>
                  `
                  : `
                    <li>No directional trade here. Stay flat on perps.</li>
                    <li>Use spot plus perp carry instead of forcing a bias.</li>
                    <li>Re-check the setup after the next 4H close.</li>
                  `
            }
          </ol>
        </div>
      </article>

      <article class="playground-combined-card">
        <div class="playground-combined-label">DLMM recommendation — ${state.selectedAsset}/USDC</div>
        <div class="playground-dlmm-head">
          <div>
            <div class="playground-dlmm-shape">${derived.dlmmRec.shape}</div>
            <div class="playground-dlmm-range">distribution · ${derived.dlmmRec.range} range</div>
          </div>
          <div class="playground-vol-pill">${derived.volatility.toFixed(1)}% daily vol</div>
        </div>
        <p class="playground-combined-copy">${derived.dlmmRec.action}</p>

        <div class="playground-checklist">
          <div class="playground-check-row">
            <span class="${derived.volatility < 4 ? "is-green" : "is-amber"}">${derived.volatility < 4 ? "✓" : "!"}</span>
            <span>Volatility: <strong>${derived.volatility.toFixed(1)}%/day</strong></span>
          </div>
          <div class="playground-check-row">
            <span class="${derived.emaSignal === "bullish" ? "is-green" : "is-amber"}">${derived.emaSignal === "bullish" ? "✓" : "!"}</span>
            <span>Trend: <strong>${derived.emaSignal}</strong></span>
          </div>
          <div class="playground-check-row">
            <span class="is-green">✓</span>
            <span>Set a rebalance alert around ±${(flowRange * 0.65).toFixed(0)}% from entry.</span>
          </div>
        </div>

        <div class="playground-note-card">
          <strong>Setup plan</strong>
          <ol class="playground-rule-list">
            <li>Deploy in ${state.selectedAsset}/USDC on Meteora DLMM.</li>
            <li>Use the <strong>${derived.dlmmRec.shape}</strong> shape across ${derived.dlmmRec.range} from current price.</li>
            <li>Trigger a rebalance review after a move of roughly ±${(flowRange * 0.65).toFixed(0)}%.</li>
            <li>Track fee yield plus incentive emissions together.</li>
            <li>Add the position to the DLMM tab above for monitoring.</li>
          </ol>
        </div>
      </article>
    </div>
  `;
}

function renderContent() {
  const content = document.querySelector("#playground-content");
  if (!content) return;

  const derived = getDerivedState();
  if (state.activeTab === 0) content.innerHTML = renderFundingTab(derived);
  if (state.activeTab === 1) content.innerHTML = renderEmaTab(derived);
  if (state.activeTab === 2) content.innerHTML = renderDlmmTab(derived);
  if (state.activeTab === 3) content.innerHTML = renderCombinedTab(derived);

  bindContentEvents();
}

function renderTabs() {
  document.querySelectorAll(".playground-tab").forEach((button) => {
    const isActive = Number(button.dataset.tabIndex) === state.activeTab;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });
}

function renderHeaderControls() {
  const picker = document.querySelector("#playground-asset-picker");
  if (picker && picker.value !== state.selectedAsset) picker.value = state.selectedAsset;

  const alertsButton = document.querySelector("#playground-alerts-toggle");
  if (alertsButton) {
    alertsButton.textContent = state.alertsEnabled ? "Alerts On" : "Enable Alerts";
    alertsButton.classList.toggle("is-enabled", state.alertsEnabled);
  }
}

function render() {
  renderHeaderControls();
  renderTabs();
  renderContent();
}

async function enableAlerts() {
  if (!("Notification" in window)) return;
  const permission = await Notification.requestPermission();
  state.alertsEnabled = permission === "granted";
  renderHeaderControls();
}

function maybeFireFundingAlerts() {
  if (!state.alertsEnabled || !("Notification" in window) || Notification.permission !== "granted") return;
  const derived = getDerivedState();
  derived.fundingSignals.forEach((item) => {
    if (item.signal === "strong-arb" || item.signal === "arb") {
      new Notification(`${item.asset} Funding Alert`, {
        body: `Rate: ${(item.rate * 100).toFixed(4)}% per 8h — arb threshold crossed.`,
      });
    }
  });
}

function addPosition() {
  if (!state.newPos.pair || !state.newPos.entryPrice || !state.newPos.currentPrice) return;
  state.dlmmPositions.push({
    id: Date.now(),
    pair: state.newPos.pair,
    entryPrice: Number(state.newPos.entryPrice),
    currentPrice: Number(state.newPos.currentPrice),
    rangePct: Number(state.newPos.rangePct),
    shape: state.newPos.shape,
  });
  state.newPos = { pair: "", entryPrice: "", currentPrice: "", rangePct: 15, shape: "Curve" };
  renderContent();
}

function applyPriceUpdate(id) {
  const value = state.priceInputs[id];
  if (!value || Number.isNaN(Number(value))) return;
  state.dlmmPositions = state.dlmmPositions.map((position) =>
    position.id === id ? { ...position, currentPrice: Number(value) } : position
  );
  state.priceInputs[id] = "";
  renderContent();
}

function bindContentEvents() {
  const thresholdInput = document.querySelector("#playground-alert-threshold");
  if (thresholdInput) {
    thresholdInput.addEventListener("input", (event) => {
      state.alertThreshold = Number(event.target.value) || 0.06;
      renderContent();
    });
  }

  document.querySelectorAll("[data-remove-position]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = Number(button.dataset.removePosition);
      state.dlmmPositions = state.dlmmPositions.filter((position) => position.id !== id);
      renderContent();
    });
  });

  document.querySelectorAll("[data-price-input]").forEach((input) => {
    input.addEventListener("input", (event) => {
      state.priceInputs[Number(input.dataset.priceInput)] = event.target.value;
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyPriceUpdate(Number(input.dataset.priceInput));
      }
    });
  });

  document.querySelectorAll("[data-apply-price]").forEach((button) => {
    button.addEventListener("click", () => {
      applyPriceUpdate(Number(button.dataset.applyPrice));
    });
  });

  const pair = document.querySelector("#playground-new-pair");
  const entry = document.querySelector("#playground-new-entry");
  const current = document.querySelector("#playground-new-current");
  const shape = document.querySelector("#playground-new-shape");
  const range = document.querySelector("#playground-new-range");
  const addButton = document.querySelector("#playground-add-position");

  if (pair) pair.addEventListener("input", (event) => { state.newPos.pair = event.target.value; });
  if (entry) entry.addEventListener("input", (event) => { state.newPos.entryPrice = event.target.value; });
  if (current) current.addEventListener("input", (event) => { state.newPos.currentPrice = event.target.value; });
  if (shape) shape.addEventListener("change", (event) => { state.newPos.shape = event.target.value; });
  if (range) range.addEventListener("input", (event) => { state.newPos.rangePct = event.target.value; });
  if (addButton) addButton.addEventListener("click", addPosition);
}

function bindStaticEvents() {
  document.querySelectorAll(".playground-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = Number(button.dataset.tabIndex);
      render();
    });
  });

  const picker = document.querySelector("#playground-asset-picker");
  if (picker) {
    picker.addEventListener("change", (event) => {
      if (ASSETS.includes(event.target.value)) {
        state.selectedAsset = event.target.value;
        render();
      }
    });
  }

  const alertsButton = document.querySelector("#playground-alerts-toggle");
  if (alertsButton) {
    alertsButton.addEventListener("click", async () => {
      await enableAlerts();
      maybeFireFundingAlerts();
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  bindStaticEvents();
  render();
});
