const { getRuntimeState } = require("./neon-db");
const {
  defaultRuntimeState: defaultHouseRuntimeState,
  sanitizeRuntimeState: sanitizeHouseRuntimeState,
} = require("./house-runtime");
const {
  defaultRuntimeState: defaultTradezRuntimeState,
  sanitizeRuntimeState: sanitizeTradezRuntimeState,
} = require("./tradez-runtime");

const METEORA_BASE_URL = "https://dlmm.datapi.meteora.ag";
const REPORT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const MAX_LOG_ENTRIES = 80;
const MAX_ALERT_IDS = 200;
const MAX_DLMM_CALLS = 160;
const MAX_PERPS_CALLS = 160;
const PERPS_MODULE = "perps";
const DLMM_MODULE = "dlmm";

const PLAYGROUND_FALLBACK_UNIVERSE = [
  { symbol: "BTCUSDT", quoteVolume: 5_000_000_000 },
  { symbol: "ETHUSDT", quoteVolume: 2_000_000_000 },
  { symbol: "SOLUSDT", quoteVolume: 1_200_000_000 },
  { symbol: "BNBUSDT", quoteVolume: 800_000_000 },
  { symbol: "XRPUSDT", quoteVolume: 600_000_000 },
  { symbol: "DOGEUSDT", quoteVolume: 500_000_000 },
  { symbol: "AVAXUSDT", quoteVolume: 350_000_000 },
  { symbol: "ADAUSDT", quoteVolume: 280_000_000 },
  { symbol: "LINKUSDT", quoteVolume: 220_000_000 },
  { symbol: "SUIUSDT", quoteVolume: 190_000_000 },
  { symbol: "DOTUSDT", quoteVolume: 160_000_000 },
  { symbol: "LTCUSDT", quoteVolume: 140_000_000 },
  { symbol: "NEARUSDT", quoteVolume: 130_000_000 },
  { symbol: "APTUSDT", quoteVolume: 120_000_000 },
  { symbol: "OPUSDT", quoteVolume: 110_000_000 },
];

function defaultModuleWebhookHealth() {
  return {
    status: "idle",
    message: "Not tested yet",
    lastResultAt: 0,
  };
}

function defaultRuntimeState() {
  return {
    perps: {
      scannerEnabled: true,
      scanIntervalMs: 5 * 60_000,
      webhook: "",
      webhookHealth: defaultModuleWebhookHealth(),
      recentCalls: [],
      playgroundSignals: [],
      scanLog: [],
      alertLog: [],
      sentIds: [],
      lastSyncAt: 0,
      lastError: "",
      runtime: {
        backgroundAvailable: true,
        houseLastScanAt: 0,
        tradezLastScanAt: 0,
        universe: [],
        universeSource: "",
        universeWarning: "",
      },
    },
    dlmm: {
      scannerEnabled: true,
      scanIntervalMs: 5 * 60_000,
      webhook: "",
      webhookHealth: defaultModuleWebhookHealth(),
      pools: [],
      protocolMetrics: null,
      recentCalls: [],
      scanLog: [],
      alertLog: [],
      sentIds: [],
      lastSyncAt: 0,
      lastError: "",
      selectedPoolAddress: "",
    },
    backgroundManaged: true,
  };
}

function sanitizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeWebhookHealth(value = {}) {
  return {
    status: String(value.status || "idle"),
    message: String(value.message || "Not tested yet").slice(0, 240),
    lastResultAt: sanitizeNumber(value.lastResultAt, 0),
  };
}

function sanitizeLogEntry(entry = {}) {
  return {
    time: sanitizeNumber(entry.time, Date.now()),
    tone: entry.tone === "up" || entry.tone === "down" ? entry.tone : "neutral",
    message: String(entry.message || "").slice(0, 400),
  };
}

function sanitizeDlmmCall(call = {}) {
  return {
    id: String(call.id || "").slice(0, 180),
    address: String(call.address || "").slice(0, 120),
    pairLabel: String(call.pairLabel || "").slice(0, 80),
    strategy: String(call.strategy || "").slice(0, 40),
    status: call.status === "Closed" ? "Closed" : "Open",
    detectedAt: sanitizeNumber(call.detectedAt, 0),
    lastSeenAt: sanitizeNumber(call.lastSeenAt, 0),
    initialEdgeScore: sanitizeNumber(call.initialEdgeScore),
    currentEdgeScore: sanitizeNumber(call.currentEdgeScore),
    currentQualityScore: sanitizeNumber(call.currentQualityScore),
    currentStrategy: String(call.currentStrategy || call.strategy || "").slice(0, 40),
    currentRange: String(call.currentRange || "").slice(0, 40),
    binStep: sanitizeNumber(call.binStep),
    preferredBins: sanitizeNumber(call.preferredBins),
    estimatedHoldTime: String(call.estimatedHoldTime || "").slice(0, 60),
    fees5m: sanitizeNumber(call.fees5m),
    fees10m: sanitizeNumber(call.fees10m),
    fees30m: sanitizeNumber(call.fees30m),
    fees1h: sanitizeNumber(call.fees1h),
    fees24h: sanitizeNumber(call.fees24h),
    riskNotes: Array.isArray(call.riskNotes) ? call.riskNotes.map((item) => String(item).slice(0, 160)) : [],
    monitors: Array.isArray(call.monitors) ? call.monitors.map((item) => String(item).slice(0, 160)) : [],
    performancePct: sanitizeNumber(call.performancePct),
    latestNotes: Array.isArray(call.latestNotes) ? call.latestNotes.map((item) => String(item).slice(0, 160)) : [],
    misses: sanitizeNumber(call.misses),
    closedAt: sanitizeNumber(call.closedAt, 0),
  };
}

function sanitizePerpsCall(call = {}) {
  return {
    id: String(call.id || "").slice(0, 180),
    signalKey: String(call.signalKey || "").slice(0, 180),
    symbol: String(call.symbol || "").slice(0, 40),
    engine: String(call.engine || "playground").slice(0, 40),
    engineLabel: String(call.engineLabel || "Playground Engine").slice(0, 80),
    strategy: String(call.strategy || "Playground Engine").slice(0, 80),
    side: String(call.side || "Long").slice(0, 10),
    status: call.status === "Closed" ? "Closed" : "Open",
    qualityScore: sanitizeNumber(call.qualityScore),
    entryPrice: sanitizeNumber(call.entryPrice),
    stopLoss: sanitizeNumber(call.stopLoss),
    takeProfit: sanitizeNumber(call.takeProfit),
    takeProfit2: sanitizeNumber(call.takeProfit2),
    rr: sanitizeNumber(call.rr),
    timeframe: String(call.timeframe || "4H").slice(0, 12),
    openedAt: sanitizeNumber(call.openedAt, 0),
    detectedAt: sanitizeNumber(call.detectedAt, 0),
    closedAt: sanitizeNumber(call.closedAt, 0),
    returnPct: Number.isFinite(Number(call.returnPct)) ? Number(call.returnPct) : null,
    pnlUsd: Number.isFinite(Number(call.pnlUsd)) ? Number(call.pnlUsd) : null,
    lastPrice: sanitizeNumber(call.lastPrice),
    holdMs: sanitizeNumber(call.holdMs),
    qualificationReason: String(call.qualificationReason || "").slice(0, 320),
    performancePct: sanitizeNumber(call.performancePct),
    misses: sanitizeNumber(call.misses),
  };
}

function sanitizePerpsSignal(signal = {}) {
  return {
    id: String(signal.id || "").slice(0, 180),
    engine: String(signal.engine || "playground").slice(0, 40),
    engineLabel: String(signal.engineLabel || "Playground Engine").slice(0, 80),
    symbol: String(signal.symbol || "").slice(0, 40),
    side: String(signal.side || "").slice(0, 10),
    timeframe: String(signal.timeframe || "4H").slice(0, 12),
    strategy: String(signal.strategy || "Playground Engine").slice(0, 80),
    qualityScore: sanitizeNumber(signal.qualityScore),
    entryPrice: sanitizeNumber(signal.entryPrice),
    stopLoss: sanitizeNumber(signal.stopLoss),
    takeProfit: sanitizeNumber(signal.takeProfit),
    takeProfit2: sanitizeNumber(signal.takeProfit2),
    rr: sanitizeNumber(signal.rr),
    timestamp: sanitizeNumber(signal.timestamp, 0),
    qualificationReason: String(signal.qualificationReason || "").slice(0, 320),
    metrics: signal.metrics
      ? {
          rsi: sanitizeNumber(signal.metrics.rsi),
          momentum: sanitizeNumber(signal.metrics.momentum),
          atrPct: sanitizeNumber(signal.metrics.atrPct),
          emaGapPct: sanitizeNumber(signal.metrics.emaGapPct),
          fundingRatePct: sanitizeNumber(signal.metrics.fundingRatePct),
          quoteVolume: sanitizeNumber(signal.metrics.quoteVolume),
        }
      : null,
  };
}

function sanitizePool(pool = {}) {
  return {
    address: String(pool.address || "").slice(0, 120),
    pairLabel: String(pool.pairLabel || "").slice(0, 80),
    baseSymbol: String(pool.baseSymbol || "").slice(0, 40),
    quoteSymbol: String(pool.quoteSymbol || "").slice(0, 40),
    volume24h: sanitizeNumber(pool.volume24h),
    tvl: sanitizeNumber(pool.tvl),
    feeTvlRatio24h: sanitizeNumber(pool.feeTvlRatio24h),
    fees5m: sanitizeNumber(pool.fees5m),
    fees10m: sanitizeNumber(pool.fees10m),
    fees30m: sanitizeNumber(pool.fees30m),
    fees1h: sanitizeNumber(pool.fees1h),
    fees24h: sanitizeNumber(pool.fees24h),
    totalApr: sanitizeNumber(pool.totalApr),
    dynamicFeeRate: sanitizeNumber(pool.dynamicFeeRate),
    binStep: sanitizeNumber(pool.binStep),
    ageDays: sanitizeNumber(pool.ageDays),
    activityRatio: sanitizeNumber(pool.activityRatio),
    isBlacklisted: Boolean(pool.isBlacklisted),
    createdAt: sanitizeNumber(pool.createdAt, 0),
    latestPrice: sanitizeNumber(pool.latestPrice),
    analysis: pool.analysis
      ? {
          qualityScore: sanitizeNumber(pool.analysis.qualityScore),
          edgeScore: sanitizeNumber(pool.analysis.edgeScore),
          recommendedStrategy: String(pool.analysis.recommendedStrategy || "").slice(0, 40),
          preferredBins: sanitizeNumber(pool.analysis.preferredBins),
          suggestedRange: String(pool.analysis.suggestedRange || "").slice(0, 40),
          estimatedHoldTime: String(pool.analysis.estimatedHoldTime || "").slice(0, 60),
          summary: String(pool.analysis.summary || "").slice(0, 240),
          qualificationReasons: Array.isArray(pool.analysis.qualificationReasons)
            ? pool.analysis.qualificationReasons.map((item) => String(item).slice(0, 160))
            : [],
          riskNotes: Array.isArray(pool.analysis.riskNotes)
            ? pool.analysis.riskNotes.map((item) => String(item).slice(0, 160))
            : [],
          monitors: Array.isArray(pool.analysis.monitors)
            ? pool.analysis.monitors.map((item) => String(item).slice(0, 160))
            : [],
          qualifies: Boolean(pool.analysis.qualifies),
        }
      : null,
  };
}

function sanitizeRuntimeState(rawState = {}) {
  const base = defaultRuntimeState();
  return {
    perps: {
      ...base.perps,
      ...rawState.perps,
      webhook: String(rawState.perps?.webhook || "").trim(),
      webhookHealth: sanitizeWebhookHealth(rawState.perps?.webhookHealth),
      recentCalls: Array.isArray(rawState.perps?.recentCalls)
        ? rawState.perps.recentCalls.map(sanitizePerpsCall).slice(0, MAX_PERPS_CALLS)
        : [],
      playgroundSignals: Array.isArray(rawState.perps?.playgroundSignals)
        ? rawState.perps.playgroundSignals.map(sanitizePerpsSignal).slice(0, 24)
        : [],
      scanLog: Array.isArray(rawState.perps?.scanLog)
        ? rawState.perps.scanLog.map(sanitizeLogEntry).slice(0, MAX_LOG_ENTRIES)
        : [],
      alertLog: Array.isArray(rawState.perps?.alertLog)
        ? rawState.perps.alertLog.map(sanitizeLogEntry).slice(0, MAX_LOG_ENTRIES)
        : [],
      sentIds: Array.isArray(rawState.perps?.sentIds)
        ? rawState.perps.sentIds.map((id) => String(id).slice(0, 180)).slice(0, MAX_ALERT_IDS)
        : [],
      lastSyncAt: sanitizeNumber(rawState.perps?.lastSyncAt, 0),
      lastError: String(rawState.perps?.lastError || "").slice(0, 240),
      runtime: {
        backgroundAvailable: true,
        houseLastScanAt: sanitizeNumber(rawState.perps?.runtime?.houseLastScanAt, 0),
        tradezLastScanAt: sanitizeNumber(rawState.perps?.runtime?.tradezLastScanAt, 0),
        universe: Array.isArray(rawState.perps?.runtime?.universe)
          ? rawState.perps.runtime.universe
              .map((entry) => ({
                symbol: String(entry?.symbol || "").slice(0, 40),
                quoteVolume: sanitizeNumber(entry?.quoteVolume),
              }))
              .filter((entry) => entry.symbol)
              .slice(0, 60)
          : [],
        universeSource: String(rawState.perps?.runtime?.universeSource || "").slice(0, 80),
        universeWarning: String(rawState.perps?.runtime?.universeWarning || "").slice(0, 200),
      },
    },
    dlmm: {
      ...base.dlmm,
      ...rawState.dlmm,
      webhook: String(rawState.dlmm?.webhook || "").trim(),
      webhookHealth: sanitizeWebhookHealth(rawState.dlmm?.webhookHealth),
      pools: Array.isArray(rawState.dlmm?.pools)
        ? rawState.dlmm.pools.map(sanitizePool).slice(0, 180)
        : [],
      protocolMetrics: rawState.dlmm?.protocolMetrics
        ? {
            poolCount: sanitizeNumber(rawState.dlmm.protocolMetrics.poolCount),
            tvl: sanitizeNumber(rawState.dlmm.protocolMetrics.tvl),
            volume24h: sanitizeNumber(rawState.dlmm.protocolMetrics.volume24h),
          }
        : null,
      recentCalls: Array.isArray(rawState.dlmm?.recentCalls)
        ? rawState.dlmm.recentCalls.map(sanitizeDlmmCall).slice(0, MAX_DLMM_CALLS)
        : [],
      scanLog: Array.isArray(rawState.dlmm?.scanLog)
        ? rawState.dlmm.scanLog.map(sanitizeLogEntry).slice(0, MAX_LOG_ENTRIES)
        : [],
      alertLog: Array.isArray(rawState.dlmm?.alertLog)
        ? rawState.dlmm.alertLog.map(sanitizeLogEntry).slice(0, MAX_LOG_ENTRIES)
        : [],
      sentIds: Array.isArray(rawState.dlmm?.sentIds)
        ? rawState.dlmm.sentIds.map((id) => String(id).slice(0, 180)).slice(0, MAX_ALERT_IDS)
        : [],
      lastSyncAt: sanitizeNumber(rawState.dlmm?.lastSyncAt, 0),
      lastError: String(rawState.dlmm?.lastError || "").slice(0, 240),
      selectedPoolAddress: String(rawState.dlmm?.selectedPoolAddress || "").slice(0, 120),
    },
    backgroundManaged: true,
  };
}

function buildResetRuntimeState() {
  return defaultRuntimeState();
}

function formatNumber(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0%";
  return `${numeric.toFixed(digits)}%`;
}

function formatCompactUsd(value, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "$0";
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(numeric) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: digits,
  }).format(numeric);
}

function applyRuntimeSettings(currentState, patch = {}) {
  return sanitizeRuntimeState({
    ...currentState,
    perps: {
      ...currentState.perps,
      ...(patch.perps || {}),
    },
    dlmm: {
      ...currentState.dlmm,
      ...(patch.dlmm || {}),
    },
  });
}

function isDiscordWebhook(url) {
  return /^https:\/\/(discord(?:app)?\.com)\/api\/webhooks\/\d+\/[\w-]+/i.test(String(url || "").trim());
}

function formatBannerPair(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";
  if (raw.includes("/")) return raw;
  if (raw.endsWith("USDT")) return `${raw.slice(0, -4)}/USDT`;
  if (raw.endsWith("USDC")) return `${raw.slice(0, -4)}/USDC`;
  return raw;
}

function withinLookback(timestamp, now = Date.now()) {
  const value = Number(timestamp);
  return Number.isFinite(value) && now >= value && now - value <= REPORT_LOOKBACK_MS;
}

function pushModuleLog(state, moduleKey, bucket, entry, maxEntries = MAX_LOG_ENTRIES) {
  state[moduleKey][bucket].unshift({
    time: Date.now(),
    tone: entry.tone === "up" || entry.tone === "down" ? entry.tone : "neutral",
    message: String(entry.message || "").slice(0, 400),
  });
  state[moduleKey][bucket] = state[moduleKey][bucket].slice(0, maxEntries);
}

function pushSentId(state, moduleKey, id) {
  if (!id) return;
  if (!state[moduleKey].sentIds.includes(id)) {
    state[moduleKey].sentIds.unshift(id);
    state[moduleKey].sentIds = state[moduleKey].sentIds.slice(0, MAX_ALERT_IDS);
  }
}

function updateWebhookHealth(state, moduleKey, status, message) {
  state[moduleKey].webhookHealth = {
    status,
    message: String(message || "").slice(0, 240),
    lastResultAt: Date.now(),
  };
}

function normalizeTimestamp(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed > 10_000_000_000 ? parsed : parsed * 1000;
}

function readNestedMetric(source, path) {
  return String(path || "")
    .split(".")
    .reduce((value, part) => (value && value[part] !== undefined ? value[part] : undefined), source);
}

function readNumberMetric(source, variants = []) {
  for (const variant of variants) {
    const value = readNestedMetric(source, variant);
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function readDlmmFeeWindow(source, windowKey) {
  const normalized = String(windowKey || "").toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  return readNumberMetric(source, [
    `fees.${normalized}`,
    `fees.${compact}`,
    `fee.${normalized}`,
    `fee.${compact}`,
    `fee_window.${normalized}`,
    `fee_window.${compact}`,
    `fee_windows.${normalized}`,
    `fee_windows.${compact}`,
    `fee_volume.${normalized}`,
    `fee_volume.${compact}`,
    `fees_${normalized}`,
    `fees_${compact}`,
    `fee_${normalized}`,
    `fee_${compact}`,
    `fee_volume_${normalized}`,
    `fee_volume_${compact}`,
  ]);
}

function resolveBaseUrl(explicitBaseUrl) {
  if (explicitBaseUrl) return explicitBaseUrl;
  if (process.env.SOLORIS_BASE_URL) return String(process.env.SOLORIS_BASE_URL).trim();
  if (process.env.VERCEL_URL) return `https://${String(process.env.VERCEL_URL).trim()}`;
  return "https://soloris-signals.vercel.app";
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `${options.method || "GET"} ${url} failed (${response.status})`);
  }
  return payload;
}

async function postJson(url, body) {
  return fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body || {}),
  });
}

async function sendNotify(baseUrl, moduleKey, webhook, title, payload, meta = {}) {
  const event = {
    title,
    message: Object.entries(payload)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
      .join("\n"),
    symbol: payload.pair,
    side: payload.direction || payload.strategy,
    qualityScore: Number(payload.confidence) || 0,
    entryPrice: Number(payload.entry) || 0,
    stopLoss: Number(payload.stop) || 0,
    tp1: Number(payload.takeProfit) || 0,
    time: Number(payload.timestamp) || Date.now(),
    formattedMessage: `${title}\n${Object.entries(payload)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
      .join("\n")}`,
  };

  const pair = formatBannerPair(payload.pair || payload.symbol || event.symbol);
  if (moduleKey === PERPS_MODULE) {
    event.type = "perps";
    event.pair = pair;
    event.direction = String(payload.direction || payload.side || event.side || "").trim().toUpperCase();
    event.strategy = String(payload.strategy || "Perps Alerts").trim();
    event.bannerLabel = "NEW PERPS ALERT";
    event.bannerFlashFrames = [event.bannerLabel, pair].filter(Boolean);
    event.bannerTitle = [event.bannerLabel, pair, event.direction].filter(Boolean).join(" | ");
    const _fmtP = (v) =>
      Number.isFinite(Number(v)) && Number(v) > 0
        ? `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 4 })}`
        : "—";
    event.message = [
      `🚨 NEW PERPS ALERT — ${event.direction} ${pair}`,
      ``,
      `Strategy: ${event.strategy}`,
      `Timeframe: ${payload.timeframe || "4H"}`,
      `Quality: Q${payload.confidence || "—"}`,
      ``,
      `Entry: ${_fmtP(payload.entry)}`,
      `Stop Loss: ${_fmtP(payload.stop)}`,
      `Take Profit: ${_fmtP(payload.takeProfit)}`,
      `RR: ${Number.isFinite(Number(payload.rr)) ? Number(payload.rr).toFixed(2) + "R" : "—"}`,
      ``,
      `Why: ${payload.qualificationReason || "Playground Engine signal qualified."}`,
    ].join("\n");
    event.formattedMessage = event.message;
  } else {
    event.type = "dlmm";
    event.pair = pair;
    event.pool = String(payload.pool || "").trim();
    event.direction = String(payload.direction || payload.side || "").trim().toUpperCase();
    event.strategy = String(payload.strategy || "DLMM Alerts").trim();
    event.preferredBins = Number(payload.preferredBins) || 0;
    event.fees5m = Number(payload.fees5m) || 0;
    event.fees10m = Number(payload.fees10m) || 0;
    event.fees30m = Number(payload.fees30m) || 0;
    event.fees1h = Number(payload.fees1h) || 0;
    event.fees24h = Number(payload.fees24h) || 0;
    event.bannerLabel = "NEW DLMM ALERT";
    event.bannerFlashFrames = [event.bannerLabel, pair].filter(Boolean);
    event.bannerTitle = [event.bannerLabel, event.strategy, pair].filter(Boolean).join(" | ");
    const _ff = (v) => {
      const n = Number(v);
      return n > 0
        ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "—";
    };
    const _monitors = Array.isArray(payload.importantParametersToMonitor) ? payload.importantParametersToMonitor : [];
    const _tvlLine = _monitors.find((m) => String(m).startsWith("TVL")) || "";
    const _volLine = _monitors.find((m) => String(m).startsWith("24H volume")) || "";
    const _ratioLine = _monitors.find((m) => String(m).startsWith("Fee/TVL")) || "";
    const _rangeLine = _monitors.find((m) => String(m).startsWith("24H pool price range")) || "";
    const _dynLine = _monitors.find((m) => String(m).startsWith("Dynamic fee")) || "";
    const _binLine = _monitors.find((m) => String(m).startsWith("Bin step")) || "";
    const _prefLine = _monitors.find((m) => String(m).startsWith("Preferred bins")) || "";
    const _reasons = Array.isArray(payload.qualificationReason)
      ? payload.qualificationReason.join(" • ")
      : String(payload.qualificationReason || "—");
    const _risks = Array.isArray(payload.riskNotes)
      ? payload.riskNotes.join(" • ")
      : String(payload.riskNotes || "None");
    event.message = [
      `🟡 NEW DLMM ALERT — ${event.strategy} — ${pair}`,
      ``,
      `Pool CA: ${event.pool}`,
      `Strategy: ${event.strategy}`,
      `Suggested Range: ${payload.suggestedRange || "—"}`,
      `${_binLine}  |  ${_prefLine}`,
      `Estimated Hold: ${payload.estimatedHoldTime || "—"}`,
      `Confidence: ${payload.confidence || "—"}`,
      ``,
      `📊 Fee Windows (per bin)`,
      `Fees  5m: ${_ff(event.fees5m)}`,
      `Fees 10m: ${_ff(event.fees10m)}`,
      `Fees 30m: ${_ff(event.fees30m)}`,
      `Fees  1H: ${_ff(event.fees1h)}`,
      `Fees 24H: ${_ff(event.fees24h)}`,
      ``,
      `📈 Pool Metrics`,
      _tvlLine ? _tvlLine : "",
      _volLine ? _volLine : "",
      _ratioLine ? _ratioLine : "",
      _rangeLine ? `Price Range 24H: ${_rangeLine.replace("24H pool price range ", "")}` : "",
      _dynLine ? _dynLine : "",
      ``,
      `✅ Qualifies: ${_reasons}`,
      `⚠️ Risk: ${_risks}`,
    ]
      .filter((line) => line !== "")
      .join("\n");
    event.formattedMessage = event.message;
  }

  return postJson(`${resolveBaseUrl(baseUrl)}/api/notify`, {
    title: event.bannerTitle || title,
    event,
    meta,
    destinations: {
      discordWebhook: webhook,
    },
  });
}

async function loadHouseTradezState() {
  const [houseStored, tradezStored] = await Promise.all([
    getRuntimeState("house_auto_trade"),
    getRuntimeState("tradez_auto_trade"),
  ]);
  const houseState =
    houseStored?.found && houseStored.state
      ? sanitizeHouseRuntimeState(houseStored.state)
      : defaultHouseRuntimeState();
  const tradezState =
    tradezStored?.found && tradezStored.state
      ? sanitizeTradezRuntimeState(tradezStored.state)
      : defaultTradezRuntimeState();
  return { houseState, tradezState };
}

function mergePerpsCalls(houseState, tradezState) {
  const runtimePairs = [
    { key: "house", label: "House Auto Trade", state: houseState || null },
    { key: "tradez", label: "Tradez Auto Trade 2", state: tradezState || null },
  ];

  return runtimePairs.flatMap((runtimeEntry) => {
    const runtimeState = runtimeEntry.state;
    if (!runtimeState) return [];
    const openTrades = Array.isArray(runtimeState.openTrades) ? runtimeState.openTrades : [];
    const closedTrades = Array.isArray(runtimeState.closedTrades) ? runtimeState.closedTrades : [];
    return [...openTrades, ...closedTrades].map((trade) => ({
      id: trade.id || `${runtimeEntry.key}:${trade.symbol}:${trade.openedAt || trade.detectedAt || 0}`,
      engine: runtimeEntry.key,
      engineLabel: runtimeEntry.label,
      status: trade.closedAt ? "Closed" : "Open",
      symbol: trade.symbol,
      token: trade.token || "",
      side: trade.side,
      strategy:
        trade.strategyLabel ||
        (runtimeEntry.key === "tradez"
          ? "EMA 20/50 Pullback"
          : String(trade.entryReason || "").toLowerCase().includes("breakout")
            ? "House Breakout"
            : "House Trend"),
      qualityScore: Number(trade.qualityScore) || 0,
      entryPrice: Number(trade.entryPrice) || 0,
      stopLoss: Number(trade.stopLoss) || 0,
      takeProfit: Number(trade.tp1 ?? trade.takeProfit) || 0,
      takeProfit2: Number(trade.tp2) || 0,
      rr: Number(trade.rr) || 0,
      timeframe: runtimeEntry.key === "tradez" ? "1H" : String(trade.interval || "15m").toUpperCase(),
      openedAt: Number(trade.openedAt || trade.detectedAt || 0),
      detectedAt: Number(trade.detectedAt || trade.openedAt || 0),
      closedAt: Number(trade.closedAt || 0),
      returnPct: Number.isFinite(Number(trade.returnPct ?? trade.pnlPct))
        ? Number(trade.returnPct ?? trade.pnlPct)
        : null,
      pnlUsd: Number.isFinite(Number(trade.pnlUsd)) ? Number(trade.pnlUsd) : null,
      holdMs: trade.closedAt
        ? Math.max(0, Number(trade.closedAt) - Number(trade.openedAt || trade.detectedAt || 0))
        : Date.now() - Number(trade.openedAt || trade.detectedAt || Date.now()),
      qualificationReason:
        trade.entryReason || trade.signalNote || trade.keyDetails || trade.reason || "Qualified by runtime scanner.",
    }));
  });
}

function mergePerpsCandidates(houseState, tradezState) {
  const runtimePairs = [
    { key: "house", label: "House Auto Trade", state: houseState || null },
    { key: "tradez", label: "Tradez Auto Trade 2", state: tradezState || null },
  ];
  return runtimePairs.flatMap((runtimeEntry) => {
    const candidates = Array.isArray(runtimeEntry.state?.lastCandidates) ? runtimeEntry.state.lastCandidates : [];
    return candidates.map((candidate) => {
      const activeSignal = candidate.activeSignal || null;
      const strategy =
        runtimeEntry.key === "tradez"
          ? "EMA 20/50 Pullback"
          : candidate.trade?.mode === "breakout"
            ? "House Breakout"
            : "House Trend";
      return {
        id:
          activeSignal?.id ||
          `${runtimeEntry.key}:${candidate.symbol}:${activeSignal?.detectedAt || candidate.analyzedAt || candidate.identifiedAt || 0}`,
        engine: runtimeEntry.key,
        engineLabel: runtimeEntry.label,
        symbol: candidate.symbol,
        side:
          activeSignal?.side ||
          (candidate.trade?.stance === "Short" || candidate.bias?.tone === "down" ? "Short" : "Long"),
        timeframe: runtimeEntry.key === "tradez" ? "1H" : "15M",
        qualityScore:
          Number(candidate.refinedQualityScore ?? candidate.qualityScore ?? activeSignal?.qualityScore) || 0,
        entryPrice: Number(activeSignal?.entryLow ?? candidate.trade?.entry ?? candidate.currentPrice) || 0,
        stopLoss: Number(activeSignal?.stopLoss ?? candidate.trade?.stopLoss) || 0,
        takeProfit: Number(activeSignal?.tp1 ?? candidate.trade?.takeProfit) || 0,
        takeProfit2: Number(activeSignal?.tp2) || 0,
        rr: Number(activeSignal?.rr ?? candidate.trade?.rr ?? candidate.rr) || 0,
        timestamp: Number(activeSignal?.detectedAt || candidate.analyzedAt || candidate.identifiedAt || 0),
        qualificationReason:
          (Array.isArray(activeSignal?.reasonParts) ? activeSignal.reasonParts.join(" • ") : "") ||
          activeSignal?.note ||
          candidate.summary ||
          candidate.setupBias?.summary ||
          "Qualified by scanner conditions.",
        strategy,
      };
    });
  });
}

function createPerpsAlertPayload(item) {
  return {
    pair: item.symbol,
    direction: item.side,
    strategy: item.strategy,
    confidence: item.qualityScore,
    entry: item.entryPrice,
    stop: item.stopLoss,
    takeProfit: item.takeProfit,
    rr: item.rr,
    timeframe: item.timeframe,
    timestamp: item.timestamp || item.openedAt || item.detectedAt || Date.now(),
    qualificationReason: item.qualificationReason,
  };
}

function updatePerpsCalls(currentCalls = [], signals = []) {
  const now = Date.now();
  const current = Array.isArray(currentCalls) ? currentCalls.map((call) => ({ ...call })) : [];
  const openMap = new Map(
    current
      .filter((call) => call.status === "Open")
      .map((call) => [call.signalKey || `${call.symbol}:${call.side}`, call])
  );
  const seen = new Set();

  signals.forEach((signal) => {
    const signalKey = `${signal.symbol}:${signal.side}`;
    const existing = openMap.get(signalKey);
    const currentPrice = Number(signal.entryPrice) || 0;
    seen.add(signalKey);

    if (existing) {
      existing.id = signal.id;
      existing.lastPrice = currentPrice;
      existing.qualityScore = Number(signal.qualityScore) || existing.qualityScore;
      existing.takeProfit = Number(signal.takeProfit) || existing.takeProfit;
      existing.takeProfit2 = Number(signal.takeProfit2) || existing.takeProfit2;
      existing.stopLoss = Number(signal.stopLoss) || existing.stopLoss;
      existing.rr = Number(signal.rr) || existing.rr;
      existing.timeframe = signal.timeframe || existing.timeframe;
      existing.qualificationReason = signal.qualificationReason || existing.qualificationReason;
      existing.detectedAt = Number(signal.timestamp) || existing.detectedAt;
      existing.holdMs = Math.max(0, now - Number(existing.openedAt || existing.detectedAt || now));
      existing.misses = 0;
      if (existing.entryPrice > 0 && currentPrice > 0) {
        const movePct =
          existing.side === "Long"
            ? ((currentPrice - existing.entryPrice) / existing.entryPrice) * 100
            : ((existing.entryPrice - currentPrice) / existing.entryPrice) * 100;
        existing.returnPct = movePct;
        existing.performancePct = movePct;
      }
      return;
    }

    current.unshift({
      id: signal.id,
      signalKey,
      symbol: signal.symbol,
      engine: "playground",
      engineLabel: "Playground Engine",
      strategy: signal.strategy || "Playground Engine",
      side: signal.side || "Long",
      status: "Open",
      qualityScore: Number(signal.qualityScore) || 0,
      entryPrice: Number(signal.entryPrice) || 0,
      stopLoss: Number(signal.stopLoss) || 0,
      takeProfit: Number(signal.takeProfit) || 0,
      takeProfit2: Number(signal.takeProfit2) || 0,
      rr: Number(signal.rr) || 0,
      timeframe: signal.timeframe || "4H",
      openedAt: Number(signal.timestamp) || now,
      detectedAt: Number(signal.timestamp) || now,
      closedAt: 0,
      returnPct: 0,
      pnlUsd: 0,
      lastPrice: currentPrice,
      holdMs: 0,
      qualificationReason: signal.qualificationReason || "Qualified by Playground Engine.",
      performancePct: 0,
      misses: 0,
    });
  });

  current.forEach((call) => {
    if (call.status !== "Open") return;
    const signalKey = call.signalKey || `${call.symbol}:${call.side}`;
    if (seen.has(signalKey)) return;
    call.misses = Number(call.misses || 0) + 1;
    call.holdMs = Math.max(0, now - Number(call.openedAt || call.detectedAt || now));
    if (call.misses >= 2) {
      call.status = "Closed";
      call.closedAt = now;
    }
  });

  return current.slice(0, MAX_PERPS_CALLS).map(sanitizePerpsCall);
}

function _calcEma(values, period) {
  const length = Math.max(1, Number(period) || 1);
  const numbers = (values || []).map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (!numbers.length) return [];
  const multiplier = 2 / (length + 1);
  const emaValues = [numbers[0]];
  for (let index = 1; index < numbers.length; index += 1) {
    emaValues.push(numbers[index] * multiplier + emaValues[index - 1] * (1 - multiplier));
  }
  return emaValues;
}

function _calcRsi(values, period = 14) {
  const closes = (values || []).map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (closes.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const delta = closes[index] - closes[index - 1];
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  for (let index = period + 1; index < closes.length; index += 1) {
    const delta = closes[index] - closes[index - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
  }
  if (averageLoss === 0) return 100;
  const rs = averageGain / averageLoss;
  return 100 - 100 / (1 + rs);
}

function _calcMomentum(values, lookback = 6) {
  const closes = (values || []).map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (closes.length <= lookback) return 0;
  const latest = closes[closes.length - 1];
  const earlier = closes[closes.length - 1 - lookback];
  if (!Number.isFinite(latest) || !Number.isFinite(earlier) || earlier === 0) return 0;
  return ((latest - earlier) / earlier) * 100;
}

function _calcAtr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length <= period) return 0;
  const trueRanges = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    const high = Number(current.high) || 0;
    const low = Number(current.low) || 0;
    const previousClose = Number(previous.close) || 0;
    trueRanges.push(
      Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose))
    );
  }
  if (!trueRanges.length) return 0;
  let atr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let index = period; index < trueRanges.length; index += 1) {
    atr = (atr * (period - 1) + trueRanges[index]) / period;
  }
  return atr;
}

function _scorePerpSignal(symbolInfo, candles, fundingRatePct) {
  const closes = candles.map((candle) => Number(candle.close) || 0).filter((value) => value > 0);
  if (closes.length < 55) return null;

  const ema20 = _calcEma(closes, 20);
  const ema50 = _calcEma(closes, 50);
  const latestClose = closes[closes.length - 1];
  const latestEma20 = ema20[ema20.length - 1] || latestClose;
  const latestEma50 = ema50[ema50.length - 1] || latestClose;
  const previousEma20 = ema20[ema20.length - 2] || latestEma20;
  const previousEma50 = ema50[ema50.length - 2] || latestEma50;
  const latestAtr = _calcAtr(candles, 14);
  const rsi = _calcRsi(closes, 14);
  const momentum = _calcMomentum(closes, 6);
  const quoteVolume = Number(symbolInfo?.quoteVolume) || 0;
  const side =
    latestEma20 > latestEma50 && latestClose >= latestEma20 * 0.962
      ? "Long"
      : latestEma20 < latestEma50 && latestClose <= latestEma20 * 1.038
        ? "Short"
        : "";
  if (!side || !latestAtr || !latestClose) return null;

  const atrPct = (latestAtr / latestClose) * 100;
  const emaGapPct = Math.abs(latestEma20 - latestEma50) / latestClose * 100;
  const sideSign = side === "Long" ? 1 : -1;
  const slopeAligned =
    (latestEma20 - previousEma20) * sideSign > 0 &&
    (latestEma50 - previousEma50) * sideSign >= 0;
  const momentumAligned = momentum * sideSign > -0.1;
  const fundingAligned =
    side === "Long" ? Number(fundingRatePct) >= -0.02 : Number(fundingRatePct) <= 0.02;

  let qualityScore = 52;
  const reasons = [];

  if (side === "Long") {
    if (latestEma20 > latestEma50) {
      qualityScore += 10;
      reasons.push("EMA20 is leading EMA50 on 4H structure");
    }
    if (rsi >= 44 && rsi <= 70) {
      qualityScore += 8;
      reasons.push(`RSI is in the bullish continuation zone at ${formatNumber(rsi, 1)}`);
    } else if (rsi > 70) {
      qualityScore -= 4;
    }
  } else {
    if (latestEma20 < latestEma50) {
      qualityScore += 10;
      reasons.push("EMA20 is below EMA50 on 4H structure");
    }
    if (rsi <= 56 && rsi >= 30) {
      qualityScore += 8;
      reasons.push(`RSI is in the bearish continuation zone at ${formatNumber(rsi, 1)}`);
    } else if (rsi < 30) {
      qualityScore -= 4;
    }
  }

  if (slopeAligned) {
    qualityScore += 7;
    reasons.push("EMA slopes remain aligned with trend direction");
  }
  if (momentumAligned) {
    qualityScore += 7;
    reasons.push(`Momentum remains aligned (${formatPercent(momentum, 2)})`);
  }
  if (emaGapPct >= 0.45) {
    qualityScore += 7;
    reasons.push(`EMA spread is healthy at ${formatPercent(emaGapPct, 2)}`);
  } else if (emaGapPct < 0.18) {
    qualityScore -= 8;
  }
  if (atrPct >= 1.4) {
    qualityScore += 5;
    reasons.push(`ATR regime is active at ${formatPercent(atrPct, 2)}`);
  } else if (atrPct < 0.65) {
    qualityScore -= 2;
  }
  if (fundingAligned) {
    qualityScore += 4;
    reasons.push(`Funding is supportive at ${formatPercent(fundingRatePct, 4)}`);
  } else {
    qualityScore -= 6;
  }
  if (quoteVolume >= 50_000_000) {
    qualityScore += 5;
    reasons.push(`Liquidity is strong (${formatCompactUsd(quoteVolume, 1)})`);
  } else if (quoteVolume < 10_000_000) {
    qualityScore -= 2;
  }

  const stopDistance = Math.max(latestAtr * 0.9, latestClose * 0.008);
  const stopLoss = side === "Long" ? latestClose - stopDistance : latestClose + stopDistance;
  const takeProfit = side === "Long" ? latestClose + stopDistance * 1.7 : latestClose - stopDistance * 1.7;
  const rr = stopDistance > 0 ? Math.abs(takeProfit - latestClose) / Math.abs(latestClose - stopLoss) : 0;
  if (rr < 1.25) {
    qualityScore -= 10;
  } else {
    qualityScore += Math.min(8, Math.round((rr - 1) * 5));
    reasons.push(`Projected reward is ${formatNumber(rr, 2)}R`);
  }

  if (qualityScore < 44) return null;

  return {
    id: `playground:${symbolInfo.symbol}:${candles[candles.length - 1]?.closeTime || Date.now()}`,
    engine: "playground",
    engineLabel: "Playground Engine",
    symbol: symbolInfo.symbol,
    side,
    timeframe: "4H",
    strategy: "Playground Engine",
    qualityScore: Math.round(qualityScore),
    entryPrice: latestClose,
    stopLoss,
    takeProfit,
    takeProfit2: side === "Long" ? latestClose + stopDistance * 2.5 : latestClose - stopDistance * 2.5,
    rr,
    timestamp: Number(candles[candles.length - 1]?.closeTime) || Date.now(),
    qualificationReason: reasons.join(" • ") || "Playground engine 4H perps setup qualified.",
    metrics: {
      rsi,
      momentum,
      atrPct,
      emaGapPct,
      fundingRatePct: Number(fundingRatePct) || 0,
      quoteVolume,
    },
  };
}

async function fetchPerpsPlaygroundSignal(symbolInfo, baseUrl) {
  const symbol = String(symbolInfo?.symbol || "").trim().toUpperCase();
  if (!symbol) return null;
  try {
    const payload = await fetchJson(
      `${resolveBaseUrl(baseUrl)}/api/market?symbol=${encodeURIComponent(symbol)}&interval=4h`
    );
    const candles = Array.isArray(payload.candles)
      ? payload.candles.map((entry) => ({
          openTime: Number(entry.time) * 1000 || 0,
          open: Number(entry.open) || 0,
          high: Number(entry.high) || 0,
          low: Number(entry.low) || 0,
          close: Number(entry.close) || 0,
          volume: Number(entry.volume) || 0,
          closeTime: Number(entry.time) * 1000 || 0,
        }))
      : [];
    return _scorePerpSignal(symbolInfo, candles, (Number(payload.premiumIndex?.lastFundingRate) || 0) * 100);
  } catch (_marketApiError) {
    const [klines, premium] = await Promise.all([
      fetchJson(`https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=4h&limit=120`),
      fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`),
    ]);
    const candles = Array.isArray(klines)
      ? klines.map((entry) => ({
          openTime: Number(entry[0]) || 0,
          open: Number(entry[1]) || 0,
          high: Number(entry[2]) || 0,
          low: Number(entry[3]) || 0,
          close: Number(entry[4]) || 0,
          volume: Number(entry[5]) || 0,
          closeTime: Number(entry[6]) || 0,
        }))
      : [];
    return _scorePerpSignal(symbolInfo, candles, (Number(premium?.lastFundingRate) || 0) * 100);
  }
}

async function fetchPerpsUniverse(baseUrl) {
  try {
    const payload = await fetchJson(`${resolveBaseUrl(baseUrl)}/api/arena-universe`);
    const tickers = Array.isArray(payload.tickers) ? payload.tickers : [];
    if (tickers.length) {
      return {
        universe: tickers,
        source: payload.source || "arena-universe",
        warning: payload.warning || "",
      };
    }
  } catch (_error) {}
  return {
    universe: PLAYGROUND_FALLBACK_UNIVERSE,
    source: "fallback",
    warning: "Using built-in top Binance USDT perp universe.",
  };
}

async function refreshPerpsPlaygroundSignals(baseUrl) {
  const { universe, source, warning } = await fetchPerpsUniverse(baseUrl);
  const priorityUniverse = universe
    .filter((entry) => entry && entry.symbol)
    .sort((left, right) => (Number(right.quoteVolume) || 0) - (Number(left.quoteVolume) || 0));
  const symbols = [];
  priorityUniverse.forEach((entry) => {
    if (symbols.length >= 15) return;
    if (!symbols.some((item) => item.symbol === entry.symbol)) {
      symbols.push(entry);
    }
  });
  if (!symbols.length) {
    return { signals: [], universe, source, warning, attempted: 0, failed: 0 };
  }
  const results = await Promise.allSettled(symbols.map((entry) => fetchPerpsPlaygroundSignal(entry, baseUrl)));
  const failed = results.filter((result) => result.status === "rejected").length;
  const signals = results
    .map((result) => (result.status === "fulfilled" ? result.value : null))
    .filter(Boolean)
    .sort((left, right) => right.qualityScore - left.qualityScore);
  return {
    signals: signals.slice(0, 12),
    universe: universe.slice(0, 60),
    source,
    warning,
    attempted: symbols.length,
    failed,
  };
}

function dlmmPriceStats(candles = []) {
  if (!Array.isArray(candles) || !candles.length) {
    return {
      volatilityPct: 0,
      priceRangePct: 0,
    };
  }
  const highs = candles.map((entry) => Number(entry.high) || 0);
  const lows = candles.map((entry) => Number(entry.low) || 0);
  const closes = candles.map((entry) => Number(entry.close) || 0).filter((value) => value > 0);
  const high = Math.max(...highs, 0);
  const low = Math.min(...lows.filter((value) => value > 0), highs[0] || 0);
  const latest = closes[closes.length - 1] || 0;
  const priceRangePct = latest ? ((high - low) / latest) * 100 : 0;
  return {
    volatilityPct: priceRangePct / 2,
    priceRangePct,
  };
}

function deriveDlmmRange(strategy, volatilityPct) {
  if (strategy === "Curve") return `±${Math.max(6, Math.min(14, volatilityPct * 1.6 || 8)).toFixed(0)}%`;
  if (strategy === "BidAsk") return `±${Math.max(16, Math.min(32, volatilityPct * 2.2 || 20)).toFixed(0)}%`;
  return `±${Math.max(10, Math.min(22, volatilityPct * 1.9 || 14)).toFixed(0)}%`;
}

function deriveDlmmHoldTime(strategy, ageDays, activityRatio) {
  if (strategy === "Curve") return activityRatio > 0.2 ? "12-48 hours" : "1-3 days";
  if (strategy === "BidAsk") return ageDays < 14 ? "6-24 hours" : "12-36 hours";
  return activityRatio > 0.15 ? "1-3 days" : "2-5 days";
}

function deriveDlmmStrategy(pool, stats) {
  if (stats.volatilityPct <= 4 && pool.feeTvlRatio24h >= 0.35 && pool.tvl >= 250_000) return "Curve";
  if (stats.volatilityPct >= 8 || pool.activityRatio >= 0.28 || pool.binStep >= 25) return "BidAsk";
  return "Spot";
}

function derivePreferredDlmmBins(strategy, pool, stats) {
  const baseBins = strategy === "Curve" ? 20 : strategy === "BidAsk" ? 10 : 14;
  const volatilityAdjustment =
    stats.volatilityPct >= 10 ? -2 : stats.volatilityPct <= 4 ? 3 : 0;
  const activityAdjustment =
    pool.activityRatio >= 0.3 ? 2 : pool.activityRatio <= 0.1 ? -1 : 0;
  const binStepAdjustment =
    pool.binStep >= 25 ? -2 : pool.binStep > 0 && pool.binStep <= 8 ? 3 : 0;
  return Math.max(6, Math.min(28, Math.round(baseBins + volatilityAdjustment + activityAdjustment + binStepAdjustment)));
}

function buildDlmmAnalysis(pool, stats) {
  const reasons = [];
  const riskNotes = [];
  const monitors = [];
  let qualityScore = 20;

  if (pool.volume24h >= 250_000) {
    qualityScore += 18;
    reasons.push("Strong 24H volume");
  } else if (pool.volume24h >= 75_000) {
    qualityScore += 12;
    reasons.push("Usable 24H volume");
  } else {
    qualityScore -= 10;
    riskNotes.push("24H volume is still light.");
  }

  if (pool.tvl >= 500_000) {
    qualityScore += 18;
    reasons.push("Healthy TVL");
  } else if (pool.tvl >= 100_000) {
    qualityScore += 10;
    reasons.push("Adequate TVL");
  } else {
    qualityScore -= 12;
    riskNotes.push("Liquidity is thin for a sustained deployment.");
  }

  if (pool.feeTvlRatio24h >= 0.45) {
    qualityScore += 14;
    reasons.push("Fee to TVL ratio is attractive");
  } else if (pool.feeTvlRatio24h <= 0.08) {
    qualityScore -= 8;
    riskNotes.push("Fee density is soft relative to TVL.");
  }

  if (pool.totalApr >= 20) {
    qualityScore += 12;
    reasons.push("Yield stack is strong");
  } else if (pool.totalApr >= 8) {
    qualityScore += 6;
  }

  if (pool.ageDays >= 30) {
    qualityScore += 8;
    reasons.push("Pool has aged beyond its launch window");
  } else if (pool.ageDays < 7) {
    qualityScore -= 6;
    riskNotes.push("Pool is still young and can reprice aggressively.");
  }

  if (pool.activityRatio >= 0.3) {
    qualityScore += 12;
    reasons.push("Activity to liquidity ratio is strong");
  } else if (pool.activityRatio < 0.08) {
    qualityScore -= 8;
    riskNotes.push("Pool activity is not yet strong enough for a confident deployment.");
  }

  if (pool.isBlacklisted) {
    qualityScore = 0;
    riskNotes.push("Pool is flagged by the official feed.");
  }

  const strategy = deriveDlmmStrategy(pool, stats);
  const preferredBins = derivePreferredDlmmBins(strategy, pool, stats);
  const suggestedRange = deriveDlmmRange(strategy, stats.volatilityPct);
  const estimatedHoldTime = deriveDlmmHoldTime(strategy, pool.ageDays, pool.activityRatio);
  const edgeScore = pool.feeTvlRatio24h * 100 + pool.totalApr * 0.35 + pool.activityRatio * 40;

  monitors.push(`24H volume ${pool.volume24h.toFixed(0)}`);
  monitors.push(`TVL ${pool.tvl.toFixed(0)}`);
  monitors.push(`Fee/TVL 24H ${pool.feeTvlRatio24h.toFixed(2)}%`);
  if (pool.fees5m > 0) monitors.push(`Fees 5M  $${pool.fees5m.toFixed(2)}`);
  if (pool.fees10m > 0) monitors.push(`Fees 10M $${pool.fees10m.toFixed(2)}`);
  if (pool.fees30m > 0) monitors.push(`Fees 30M $${pool.fees30m.toFixed(2)}`);
  if (pool.fees1h > 0) monitors.push(`Fees 1H  $${pool.fees1h.toFixed(2)}`);
  if (pool.fees24h > 0) monitors.push(`Fees 24H $${pool.fees24h.toFixed(2)}`);
  monitors.push(`Bin step ${pool.binStep}`);
  monitors.push(`Preferred bins ${preferredBins}`);
  if (Number.isFinite(pool.dynamicFeeRate)) monitors.push(`Dynamic fee ${pool.dynamicFeeRate.toFixed(2)}%`);
  if (stats.priceRangePct > 0) monitors.push(`24H pool price range ${stats.priceRangePct.toFixed(2)}%`);

  const qualifies =
    !pool.isBlacklisted &&
    qualityScore >= 60 &&
    pool.volume24h >= 25_000 &&
    pool.tvl >= 50_000 &&
    pool.ageDays >= 1;

  return {
    qualityScore: Math.max(0, Math.min(100, Math.round(qualityScore))),
    edgeScore,
    recommendedStrategy: strategy,
    preferredBins,
    suggestedRange,
    estimatedHoldTime,
    summary: `${strategy} setup with ${pool.activityRatio.toFixed(2)} activity ratio, ${pool.feeTvlRatio24h.toFixed(2)}% fee/TVL, and ${pool.ageDays.toFixed(0)} day pool age.`,
    qualificationReasons: reasons.length ? reasons : ["Pool remains monitorable but is not yet exceptional."],
    riskNotes: riskNotes.length ? riskNotes : ["No structural risk flags from the latest official pool state."],
    monitors,
    qualifies,
  };
}

function shapeDlmmPool(rawPool = {}, candles = []) {
  const baseToken = rawPool.token_x || rawPool.tokenX || rawPool.base_token || {};
  const quoteToken = rawPool.token_y || rawPool.tokenY || rawPool.quote_token || {};
  const createdAt = normalizeTimestamp(rawPool.created_at || rawPool.createdAt || rawPool.created_time);
  const ageDays = createdAt ? Math.max(0, (Date.now() - createdAt) / (24 * 60 * 60 * 1000)) : 0;
  const volume24h = Number(rawPool.trade_volume_24h || rawPool.volume_24h || rawPool.volume?.["24h"] || 0);
  const tvl = Number(rawPool.liquidity || rawPool.tvl || rawPool.reserve_usd || 0);
  const feeTvlRatio24h = Number(rawPool.fee_tvl_ratio_24h || rawPool.fee_tvl_ratio?.["24h"] || 0);
  const baseApr = Number(rawPool.apr || rawPool.apy || 0);
  const farmApr = Number(rawPool.farm_apr || rawPool.farm_apy || 0);
  const dynamicFeeRate = Number(rawPool.dynamic_fee || rawPool.dynamic_fee_rate || rawPool.fee_rate || 0);
  const stats = dlmmPriceStats(candles);
  const pool = {
    address: rawPool.address || rawPool.pool_address || rawPool.pubkey || "",
    pairLabel:
      rawPool.name ||
      `${baseToken.symbol || baseToken.mint_symbol || "Unknown"}/${quoteToken.symbol || quoteToken.mint_symbol || "Unknown"}`,
    baseSymbol: baseToken.symbol || baseToken.mint_symbol || "Unknown",
    quoteSymbol: quoteToken.symbol || quoteToken.mint_symbol || "Unknown",
    volume24h,
    tvl,
    feeTvlRatio24h,
    fees5m: readDlmmFeeWindow(rawPool, "5m"),
    fees10m: readDlmmFeeWindow(rawPool, "10m"),
    fees30m: readDlmmFeeWindow(rawPool, "30m"),
    fees1h: readDlmmFeeWindow(rawPool, "1h"),
    fees24h: readDlmmFeeWindow(rawPool, "24h"),
    totalApr: baseApr + farmApr,
    dynamicFeeRate,
    binStep: Number(rawPool.bin_step || rawPool.binStep || rawPool.bin_size || 0),
    ageDays,
    activityRatio: tvl > 0 ? volume24h / tvl : 0,
    isBlacklisted: Boolean(rawPool.is_blacklisted || rawPool.isBlacklisted),
    createdAt,
    latestPrice: Number(rawPool.current_price || rawPool.price || 0),
  };

  return {
    ...pool,
    analysis: buildDlmmAnalysis(pool, stats),
  };
}

async function fetchDlmmPools(pageSize = 150) {
  const pages = [1, 2];
  const results = await Promise.all(
    pages.map((page) =>
      fetchJson(
        `${METEORA_BASE_URL}/pools?page=${page}&page_size=${pageSize}&sort_key=volume_24h&order_by=desc`
      ).catch(() => ({ data: [] }))
    )
  );
  return results.flatMap((payload) => payload.data || payload.pools || []);
}

async function fetchDlmmProtocolMetrics() {
  try {
    const payload = await fetchJson(`${METEORA_BASE_URL}/pair/all_by_groups`);
    const pairs = Array.isArray(payload) ? payload : payload.data || [];
    const tvl = pairs.reduce((sum, entry) => sum + (Number(entry.liquidity || entry.tvl || 0) || 0), 0);
    const volume24h = pairs.reduce(
      (sum, entry) => sum + (Number(entry.trade_volume_24h || entry.volume_24h || 0) || 0),
      0
    );
    return {
      poolCount: pairs.length,
      tvl,
      volume24h,
    };
  } catch (_error) {
    return null;
  }
}

function updateDlmmCalls(currentCalls = [], opportunities = []) {
  const now = Date.now();
  const current = Array.isArray(currentCalls) ? currentCalls.map((call) => ({ ...call })) : [];
  const openMap = new Map(current.filter((call) => call.status === "Open").map((call) => [call.address, call]));
  const seen = new Set();

  opportunities
    .filter((pool) => pool.analysis?.qualifies)
    .forEach((pool) => {
      seen.add(pool.address);
      const edgeScore = Number(pool.analysis.edgeScore) || 0;
      const existing = openMap.get(pool.address);
      if (existing) {
        existing.currentEdgeScore = edgeScore;
        existing.currentQualityScore = Number(pool.analysis.qualityScore) || 0;
        existing.currentStrategy = pool.analysis.recommendedStrategy;
        existing.currentRange = pool.analysis.suggestedRange;
        existing.binStep = pool.binStep;
        existing.preferredBins = pool.analysis.preferredBins;
        existing.fees5m = pool.fees5m;
        existing.fees10m = pool.fees10m;
        existing.fees30m = pool.fees30m;
        existing.fees1h = pool.fees1h;
        existing.fees24h = pool.fees24h;
        existing.lastSeenAt = now;
        existing.misses = 0;
        existing.performancePct = existing.initialEdgeScore
          ? ((edgeScore - existing.initialEdgeScore) / Math.abs(existing.initialEdgeScore)) * 100
          : 0;
        existing.latestNotes = pool.analysis.qualificationReasons;
      } else {
        current.unshift({
          id: `${pool.address}:${now}`,
          address: pool.address,
          pairLabel: pool.pairLabel,
          strategy: pool.analysis.recommendedStrategy,
          binStep: pool.binStep,
          status: "Open",
          detectedAt: now,
          lastSeenAt: now,
          initialEdgeScore: edgeScore,
          currentEdgeScore: edgeScore,
          currentQualityScore: Number(pool.analysis.qualityScore) || 0,
          currentStrategy: pool.analysis.recommendedStrategy,
          currentRange: pool.analysis.suggestedRange,
          preferredBins: pool.analysis.preferredBins,
          estimatedHoldTime: pool.analysis.estimatedHoldTime,
          fees5m: pool.fees5m,
          fees10m: pool.fees10m,
          fees30m: pool.fees30m,
          fees1h: pool.fees1h,
          fees24h: pool.fees24h,
          riskNotes: pool.analysis.riskNotes,
          monitors: pool.analysis.monitors,
          performancePct: 0,
          latestNotes: pool.analysis.qualificationReasons,
          misses: 0,
        });
      }
    });

  current.forEach((call) => {
    if (call.status !== "Open" || seen.has(call.address)) return;
    call.misses = Number(call.misses || 0) + 1;
    if (call.misses >= 2) {
      call.status = "Closed";
      call.closedAt = now;
    }
  });

  return current.slice(0, MAX_DLMM_CALLS).map(sanitizeDlmmCall);
}

function createDlmmAlertPayload(opportunity) {
  return {
    pair: opportunity.pairLabel,
    pool: opportunity.address,
    strategy: opportunity.analysis.recommendedStrategy,
    binStep: opportunity.binStep,
    preferredBins: opportunity.analysis.preferredBins,
    suggestedRange: opportunity.analysis.suggestedRange,
    estimatedHoldTime: opportunity.analysis.estimatedHoldTime,
    fees5m: opportunity.fees5m,
    fees10m: opportunity.fees10m,
    fees30m: opportunity.fees30m,
    fees1h: opportunity.fees1h,
    fees24h: opportunity.fees24h,
    riskNotes: opportunity.analysis.riskNotes,
    importantParametersToMonitor: opportunity.analysis.monitors,
    confidence: opportunity.analysis.qualityScore,
    qualificationReason: opportunity.analysis.qualificationReasons,
  };
}

async function sendPerpsAlerts(state, signals, baseUrl) {
  if (!state.perps.scannerEnabled || !isDiscordWebhook(state.perps.webhook)) return 0;
  const candidates = (signals || [])
    .filter((candidate) => candidate.qualityScore >= 44 && withinLookback(candidate.timestamp || Date.now()))
    .sort((left, right) => right.qualityScore - left.qualityScore);
  const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
  const deliveredSignalIds = new Set(
    (state.perps.recentCalls || [])
      .filter((call) => Number(call.openedAt || call.detectedAt || 0) > sixHoursAgo)
      .map((call) => call.id)
  );

  let sent = 0;
  for (const candidate of candidates) {
    if (deliveredSignalIds.has(candidate.id) || state.perps.sentIds.includes(candidate.id)) continue;
    try {
      const payload = createPerpsAlertPayload(candidate);
      await sendNotify(baseUrl, PERPS_MODULE, state.perps.webhook, `Playground Engine qualified ${candidate.symbol}`, payload, {
        source: "playground_perps",
        strategy: "perps_alerts",
        eventType: "scanner_signal",
      });
      pushSentId(state, PERPS_MODULE, candidate.id);
      updateWebhookHealth(state, PERPS_MODULE, "ok", "Perps alert delivery succeeded.");
      pushModuleLog(state, PERPS_MODULE, "alertLog", {
        tone: "up",
        message: `Playground Engine qualified ${candidate.symbol} sent to Discord.`,
      });
      deliveredSignalIds.add(candidate.id);
      sent += 1;
    } catch (error) {
      updateWebhookHealth(state, PERPS_MODULE, "down", error.message || "Perps Discord delivery failed.");
      pushModuleLog(state, PERPS_MODULE, "alertLog", {
        tone: "down",
        message: error.message || "Perps Discord delivery failed.",
      });
      break;
    }
  }
  return sent;
}

async function sendDlmmAlerts(state, baseUrl) {
  if (!state.dlmm.scannerEnabled || !isDiscordWebhook(state.dlmm.webhook)) return 0;
  const newCalls = state.dlmm.recentCalls.filter(
    (call) => call.status === "Open" && withinLookback(call.detectedAt) && !state.dlmm.sentIds.includes(call.id)
  );
  let sent = 0;
  for (const call of newCalls) {
    const payload = createDlmmAlertPayload({
      address: call.address,
      pairLabel: call.pairLabel,
      analysis: {
        recommendedStrategy: call.strategy,
        suggestedRange: call.currentRange,
        preferredBins: call.preferredBins,
        estimatedHoldTime: call.estimatedHoldTime,
        riskNotes: call.riskNotes,
        monitors: call.monitors,
        qualityScore: call.currentQualityScore,
        qualificationReasons: call.latestNotes,
      },
      binStep: call.binStep || null,
      fees5m: call.fees5m,
      fees10m: call.fees10m,
      fees30m: call.fees30m,
      fees1h: call.fees1h,
      fees24h: call.fees24h,
    });
    try {
      await sendNotify(baseUrl, DLMM_MODULE, state.dlmm.webhook, `DLMM opportunity qualified ${call.pairLabel}`, payload, {
        source: "playground_dlmm",
        strategy: "dlmm_alerts",
        eventType: "scanner_signal",
      });
      pushSentId(state, DLMM_MODULE, call.id);
      updateWebhookHealth(state, DLMM_MODULE, "ok", "DLMM alert delivery succeeded.");
      pushModuleLog(state, DLMM_MODULE, "alertLog", {
        tone: "up",
        message: `${call.pairLabel} DLMM alert sent to Discord.`,
      });
      sent += 1;
    } catch (error) {
      updateWebhookHealth(state, DLMM_MODULE, "down", error.message || "DLMM Discord delivery failed.");
      pushModuleLog(state, DLMM_MODULE, "alertLog", {
        tone: "down",
        message: error.message || "DLMM Discord delivery failed.",
      });
      break;
    }
  }
  return sent;
}

async function runPlaygroundScan(stateInput = {}, options = {}) {
  const state = sanitizeRuntimeState(stateInput);
  const baseUrl = resolveBaseUrl(options.baseUrl);
  const manual = Boolean(options.manual);
  const modules = Array.isArray(options.modules) && options.modules.length ? options.modules : [PERPS_MODULE, DLMM_MODULE];
  const summary = {
    ok: true,
    perpsSent: 0,
    dlmmSent: 0,
  };

  if (modules.includes(PERPS_MODULE)) {
    try {
      const { houseState, tradezState } = await loadHouseTradezState();
      const { signals, universe, source, warning, attempted, failed } = await refreshPerpsPlaygroundSignals(baseUrl);
      state.perps.runtime = {
        backgroundAvailable: true,
        houseLastScanAt: Number(houseState.lastScanAt || 0),
        tradezLastScanAt: Number(tradezState.lastScanAt || 0),
        universe,
        universeSource: source,
        universeWarning: warning,
      };
      state.perps.playgroundSignals = signals.map(sanitizePerpsSignal);
      state.perps.recentCalls = updatePerpsCalls(state.perps.recentCalls, signals);
      state.perps.lastSyncAt = Date.now();
      state.perps.lastError = "";
      const degradedDetail = failed
        ? ` Scanner degraded: ${failed}/${attempted || 1} symbol fetches failed.`
        : "";
      const warningDetail = warning ? ` ${warning}` : "";
      pushModuleLog(state, PERPS_MODULE, "scanLog", {
        tone: failed ? "down" : signals.length ? "up" : "neutral",
        message: signals.length
          ? `Playground Engine qualified ${signals.length} live perps setup${signals.length === 1 ? "" : "s"} across ${Math.min(universe.length, 15)} symbols.${degradedDetail}${warningDetail}`
          : manual
            ? `Manual perps background refresh completed with no fresh setup.${degradedDetail}${warningDetail}`
            : `Perps background refresh completed with no fresh setup.${degradedDetail}${warningDetail}`,
      });
      summary.perpsSent = await sendPerpsAlerts(state, signals, baseUrl);
    } catch (error) {
      state.perps.lastError = error.message || "Perps background refresh failed.";
      pushModuleLog(state, PERPS_MODULE, "scanLog", {
        tone: "down",
        message: state.perps.lastError,
      });
      summary.ok = false;
      summary.perpsError = state.perps.lastError;
    }
  }

  if (modules.includes(DLMM_MODULE)) {
    try {
      const [rawPools, protocolMetrics] = await Promise.all([fetchDlmmPools(150), fetchDlmmProtocolMetrics()]);
      const pools = rawPools
        .map((pool) => shapeDlmmPool(pool))
        .sort(
          (left, right) =>
            (right.analysis?.qualityScore || 0) - (left.analysis?.qualityScore || 0) ||
            right.volume24h - left.volume24h
        );
      state.dlmm.pools = pools.slice(0, 180).map(sanitizePool);
      state.dlmm.protocolMetrics = protocolMetrics;
      state.dlmm.lastSyncAt = Date.now();
      state.dlmm.lastError = "";
      if (!state.dlmm.selectedPoolAddress && state.dlmm.pools.length) {
        state.dlmm.selectedPoolAddress = state.dlmm.pools[0].address;
      }
      state.dlmm.recentCalls = updateDlmmCalls(state.dlmm.recentCalls, pools);
      pushModuleLog(state, DLMM_MODULE, "scanLog", {
        tone: "neutral",
        message: manual ? "Manual DLMM background refresh completed." : "DLMM background refresh completed.",
      });
      summary.dlmmSent = await sendDlmmAlerts(state, baseUrl);
    } catch (error) {
      state.dlmm.lastError = error.message || "DLMM background refresh failed.";
      pushModuleLog(state, DLMM_MODULE, "scanLog", {
        tone: "down",
        message: state.dlmm.lastError,
      });
      summary.ok = false;
      summary.dlmmError = state.dlmm.lastError;
    }
  }

  return {
    state: sanitizeRuntimeState(state),
    summary,
  };
}

async function sendTestAlert(stateInput = {}, moduleKey, options = {}) {
  const state = sanitizeRuntimeState(stateInput);
  const baseUrl = resolveBaseUrl(options.baseUrl);
  const moduleState = moduleKey === DLMM_MODULE ? state.dlmm : state.perps;
  if (!isDiscordWebhook(moduleState.webhook)) {
    throw new Error("Invalid Discord webhook.");
  }

  if (moduleKey === PERPS_MODULE) {
    await sendNotify(baseUrl, PERPS_MODULE, moduleState.webhook, "Soloris Perps Alert Test", {
      pair: "BTCUSDT",
      direction: "Long",
      strategy: "Test Signal",
      confidence: 88,
      entry: 100,
      stop: 96,
      takeProfit: 108,
      rr: 2,
      timeframe: "1H",
      timestamp: Date.now(),
      qualificationReason: "Webhook validation test from Playground",
    }, {
      source: "playground_perps",
      strategy: "perps_alerts",
      eventType: "test_signal",
    });
    updateWebhookHealth(state, PERPS_MODULE, "ok", "Perps webhook test sent.");
    pushModuleLog(state, PERPS_MODULE, "alertLog", {
      tone: "up",
      message: "Perps webhook test sent successfully.",
    });
  } else {
    await sendNotify(baseUrl, DLMM_MODULE, moduleState.webhook, "Soloris DLMM Alert Test", {
      pair: "SOL/USDC",
      pool: "manual-test",
      strategy: "Curve",
      binStep: 20,
      preferredBins: 16,
      suggestedRange: "±10%",
      estimatedHoldTime: "1-3 days",
      fees5m: 55,
      fees10m: 120,
      fees30m: 340,
      fees1h: 620,
      fees24h: 4800,
      riskNotes: ["Webhook validation test"],
      importantParametersToMonitor: ["TVL", "24H volume", "Fee/TVL ratio"],
      confidence: 82,
      qualificationReason: ["Webhook validation test from Playground"],
    }, {
      source: "playground_dlmm",
      strategy: "dlmm_alerts",
      eventType: "test_signal",
    });
    updateWebhookHealth(state, DLMM_MODULE, "ok", "DLMM webhook test sent.");
    pushModuleLog(state, DLMM_MODULE, "alertLog", {
      tone: "up",
      message: "DLMM webhook test sent successfully.",
    });
  }

  return sanitizeRuntimeState(state);
}

module.exports = {
  defaultRuntimeState,
  sanitizeRuntimeState,
  buildResetRuntimeState,
  applyRuntimeSettings,
  runPlaygroundScan,
  sendTestAlert,
};
