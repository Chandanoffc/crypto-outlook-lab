const PLAYGROUND_STORAGE_KEY = "soloris-playground-ops-v2";
const PERPS_SCAN_INTERVAL_OPTIONS = [
  { label: "1 minute", value: 60_000 },
  { label: "5 minutes", value: 5 * 60_000 },
  { label: "15 minutes", value: 15 * 60_000 },
];
const DLMM_SCAN_INTERVAL_OPTIONS = [
  { label: "2 minutes", value: 2 * 60_000 },
  { label: "5 minutes", value: 5 * 60_000 },
  { label: "15 minutes", value: 15 * 60_000 },
];
const REPORT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const MAX_SUGGESTIONS = 10;
const MAX_LOG_ENTRIES = 80;
const MAX_ALERT_IDS = 200;
const PERPS_MODULE = "perps";
const DLMM_MODULE = "dlmm";

const state = loadState();
let perpsTimer = null;
let dlmmTimer = null;
let perpsInFlight = false;
let dlmmInFlight = false;

function defaultModuleWebhookHealth() {
  return {
    status: "idle",
    message: "Not tested yet",
    lastResultAt: 0,
  };
}

function loadState() {
  const fallback = {
    activeModule: PERPS_MODULE,
    perps: {
      scannerEnabled: true,
      scanIntervalMs: 5 * 60_000,
      selectorQuery: "",
      selectedSymbol: "",
      webhook: "",
      webhookHealth: defaultModuleWebhookHealth(),
      runtime: {
        house: null,
        tradez: null,
        universe: [],
        universeSource: "",
        universeWarning: "",
        backgroundAvailable: false,
      },
      manualScan: null,
      scanLog: [],
      alertLog: [],
      sentIds: [],
      lastSyncAt: 0,
      lastError: "",
      loading: false,
    },
    dlmm: {
      scannerEnabled: true,
      scanIntervalMs: 5 * 60_000,
      selectorQuery: "",
      selectedPoolAddress: "",
      webhook: "",
      webhookHealth: defaultModuleWebhookHealth(),
      pools: [],
      protocolMetrics: null,
      manualScan: null,
      recentCalls: [],
      scanLog: [],
      alertLog: [],
      sentIds: [],
      lastSyncAt: 0,
      lastError: "",
      loading: false,
    },
  };

  try {
    const stored = JSON.parse(window.localStorage.getItem(PLAYGROUND_STORAGE_KEY) || "{}");
    return {
      activeModule: stored.activeModule === DLMM_MODULE ? DLMM_MODULE : PERPS_MODULE,
      perps: {
        ...fallback.perps,
        ...stored.perps,
        webhookHealth: {
          ...defaultModuleWebhookHealth(),
          ...(stored.perps?.webhookHealth || {}),
        },
        runtime: {
          ...fallback.perps.runtime,
          ...(stored.perps?.runtime || {}),
          house: null,
          tradez: null,
          universe: Array.isArray(stored.perps?.runtime?.universe) ? stored.perps.runtime.universe : [],
        },
        scanLog: Array.isArray(stored.perps?.scanLog) ? stored.perps.scanLog.slice(0, MAX_LOG_ENTRIES) : [],
        alertLog: Array.isArray(stored.perps?.alertLog) ? stored.perps.alertLog.slice(0, MAX_LOG_ENTRIES) : [],
        sentIds: Array.isArray(stored.perps?.sentIds) ? stored.perps.sentIds.slice(0, MAX_ALERT_IDS) : [],
        manualScan: null,
        lastError: "",
        loading: false,
      },
      dlmm: {
        ...fallback.dlmm,
        ...stored.dlmm,
        webhookHealth: {
          ...defaultModuleWebhookHealth(),
          ...(stored.dlmm?.webhookHealth || {}),
        },
        pools: Array.isArray(stored.dlmm?.pools) ? stored.dlmm.pools : [],
        recentCalls: Array.isArray(stored.dlmm?.recentCalls) ? stored.dlmm.recentCalls.slice(0, 160) : [],
        scanLog: Array.isArray(stored.dlmm?.scanLog) ? stored.dlmm.scanLog.slice(0, MAX_LOG_ENTRIES) : [],
        alertLog: Array.isArray(stored.dlmm?.alertLog) ? stored.dlmm.alertLog.slice(0, MAX_LOG_ENTRIES) : [],
        sentIds: Array.isArray(stored.dlmm?.sentIds) ? stored.dlmm.sentIds.slice(0, MAX_ALERT_IDS) : [],
        manualScan: null,
        lastError: "",
        loading: false,
      },
    };
  } catch (_error) {
    return fallback;
  }
}

function persistState() {
  const payload = {
    activeModule: state.activeModule,
    perps: {
      scannerEnabled: state.perps.scannerEnabled,
      scanIntervalMs: state.perps.scanIntervalMs,
      selectorQuery: state.perps.selectorQuery,
      selectedSymbol: state.perps.selectedSymbol,
      webhook: state.perps.webhook,
      webhookHealth: state.perps.webhookHealth,
      runtime: {
        universe: state.perps.runtime.universe,
        universeSource: state.perps.runtime.universeSource,
        universeWarning: state.perps.runtime.universeWarning,
        backgroundAvailable: state.perps.runtime.backgroundAvailable,
      },
      scanLog: state.perps.scanLog.slice(0, MAX_LOG_ENTRIES),
      alertLog: state.perps.alertLog.slice(0, MAX_LOG_ENTRIES),
      sentIds: state.perps.sentIds.slice(0, MAX_ALERT_IDS),
      lastSyncAt: state.perps.lastSyncAt,
    },
    dlmm: {
      scannerEnabled: state.dlmm.scannerEnabled,
      scanIntervalMs: state.dlmm.scanIntervalMs,
      selectorQuery: state.dlmm.selectorQuery,
      selectedPoolAddress: state.dlmm.selectedPoolAddress,
      webhook: state.dlmm.webhook,
      webhookHealth: state.dlmm.webhookHealth,
      pools: state.dlmm.pools.slice(0, 180),
      protocolMetrics: state.dlmm.protocolMetrics,
      recentCalls: state.dlmm.recentCalls.slice(0, 160),
      scanLog: state.dlmm.scanLog.slice(0, MAX_LOG_ENTRIES),
      alertLog: state.dlmm.alertLog.slice(0, MAX_LOG_ENTRIES),
      sentIds: state.dlmm.sentIds.slice(0, MAX_ALERT_IDS),
      lastSyncAt: state.dlmm.lastSyncAt,
    },
  };
  window.localStorage.setItem(PLAYGROUND_STORAGE_KEY, JSON.stringify(payload));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDateTime(timestamp) {
  if (!Number.isFinite(Number(timestamp)) || Number(timestamp) <= 0) return "—";
  return new Date(Number(timestamp)).toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPercent(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return "—";
  const numeric = Number(value);
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(digits)}%`;
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}

function formatCompactUsd(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    notation: Math.abs(Number(value)) >= 1000 ? "compact" : "standard",
  }).format(Number(value));
}

function formatUsd(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  }).format(Number(value));
}

function formatDuration(ms) {
  if (!Number.isFinite(Number(ms)) || Number(ms) <= 0) return "—";
  const totalMinutes = Math.round(Number(ms) / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes && parts.length < 2) parts.push(`${minutes}m`);
  return parts.join(" ") || "0m";
}

function isDiscordWebhook(url) {
  return /^https:\/\/(discord(?:app)?\.com)\/api\/webhooks\/\d+\/[\w-]+/i.test(String(url || "").trim());
}

function withinLookback(timestamp, now = Date.now()) {
  const value = Number(timestamp);
  return Number.isFinite(value) && now >= value && now - value <= REPORT_LOOKBACK_MS;
}

function updateWebhookHealth(moduleKey, status, message) {
  state[moduleKey].webhookHealth = {
    status,
    message,
    lastResultAt: Date.now(),
  };
  persistState();
  render();
}

function pushModuleLog(moduleKey, bucket, entry, maxEntries = MAX_LOG_ENTRIES) {
  state[moduleKey][bucket].unshift({
    time: Date.now(),
    ...entry,
  });
  state[moduleKey][bucket] = state[moduleKey][bucket].slice(0, maxEntries);
}

function pushSentId(moduleKey, id) {
  if (!id) return;
  if (!state[moduleKey].sentIds.includes(id)) {
    state[moduleKey].sentIds.unshift(id);
    state[moduleKey].sentIds = state[moduleKey].sentIds.slice(0, MAX_ALERT_IDS);
  }
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

function downloadJsonFile(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 0);
}

function schedulePerpsScanner() {
  if (perpsTimer) window.clearInterval(perpsTimer);
  if (!state.perps.scannerEnabled) return;
  perpsTimer = window.setInterval(() => {
    refreshPerpsData({ fullScan: true, source: "scheduled" });
  }, state.perps.scanIntervalMs);
}

function scheduleDlmmScanner() {
  if (dlmmTimer) window.clearInterval(dlmmTimer);
  if (!state.dlmm.scannerEnabled) return;
  dlmmTimer = window.setInterval(() => {
    refreshDlmmData({ source: "scheduled" });
  }, state.dlmm.scanIntervalMs);
}

function mergePerpsCalls() {
  const runtimePairs = [
    { key: "house", label: "House Auto Trade", state: state.perps.runtime.house?.state || null },
    { key: "tradez", label: "Tradez Auto Trade 2", state: state.perps.runtime.tradez?.state || null },
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
          : trade.entryReason?.toLowerCase().includes("breakout")
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
      returnPct: Number.isFinite(Number(trade.returnPct ?? trade.pnlPct)) ? Number(trade.returnPct ?? trade.pnlPct) : null,
      pnlUsd: Number.isFinite(Number(trade.pnlUsd)) ? Number(trade.pnlUsd) : null,
      lastPrice: Number(trade.lastPrice) || 0,
      holdMs: trade.closedAt ? Math.max(0, Number(trade.closedAt) - Number(trade.openedAt || trade.detectedAt || 0)) : Date.now() - Number(trade.openedAt || trade.detectedAt || Date.now()),
      qualificationReason:
        trade.entryReason ||
        trade.signalNote ||
        trade.keyDetails ||
        trade.reason ||
        "Qualified by runtime scanner.",
      raw: trade,
    }));
  });
}

function mergePerpsCandidates() {
  const runtimePairs = [
    { key: "house", label: "House Auto Trade", state: state.perps.runtime.house?.state || null },
    { key: "tradez", label: "Tradez Auto Trade 2", state: state.perps.runtime.tradez?.state || null },
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
        entryPrice:
          Number(activeSignal?.entryLow ?? candidate.trade?.entry ?? candidate.currentPrice) || 0,
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
        activeSignal,
        raw: candidate,
        strategy,
      };
    });
  });
}

function computePerpsMetrics(calls) {
  const now = Date.now();
  const closed = calls.filter((call) => call.status === "Closed");
  const open = calls.filter((call) => call.status === "Open");
  const wins = closed.filter((call) => Number(call.returnPct) > 0);
  const losses = closed.filter((call) => Number(call.returnPct) <= 0);
  const averageRr = calls.length
    ? calls.reduce((sum, call) => sum + (Number(call.rr) || 0), 0) / calls.length
    : 0;
  const averageHold = closed.length
    ? closed.reduce((sum, call) => sum + (Number(call.holdMs) || 0), 0) / closed.length
    : 0;
  const pairPerformance = new Map();
  closed.forEach((call) => {
    const current = pairPerformance.get(call.symbol) || { sum: 0, count: 0 };
    current.sum += Number(call.returnPct) || 0;
    current.count += 1;
    pairPerformance.set(call.symbol, current);
  });
  const sortedPairs = Array.from(pairPerformance.entries())
    .map(([symbol, record]) => ({
      symbol,
      avgReturnPct: record.count ? record.sum / record.count : 0,
      count: record.count,
    }))
    .sort((left, right) => right.avgReturnPct - left.avgReturnPct);

  return {
    totalCallsOverall: calls.length,
    totalCallsToday: calls.filter((call) => withinLookback(call.openedAt || call.detectedAt, now)).length,
    wins: wins.length,
    losses: losses.length,
    openCalls: open.length,
    profitPercentage: closed.length ? (wins.length / closed.length) * 100 : 0,
    lossPercentage: closed.length ? (losses.length / closed.length) * 100 : 0,
    averageRr,
    averageHold,
    bestPairs: sortedPairs.slice(0, 3),
    worstPairs: sortedPairs.slice(-3).reverse(),
  };
}

function bestWorstLabel(entries) {
  if (!entries.length) return "—";
  return entries
    .map((entry) => `${entry.symbol} (${formatPercent(entry.avgReturnPct, 1)})`)
    .join(" · ");
}

function perpsScannerHealthLabel() {
  const house = state.perps.runtime.house;
  const tradez = state.perps.runtime.tradez;
  if (state.perps.loading) return { label: "Scanning", note: "Refreshing House and Tradez runtimes" };
  if (state.perps.lastError) return { label: "Degraded", note: state.perps.lastError };
  const available = Boolean(house?.backgroundAvailable && tradez?.backgroundAvailable);
  if (!available) return { label: "Partial", note: "Runtime background storage is unavailable or not synced." };
  const lastScanAt = Math.max(Number(house?.state?.lastScanAt || 0), Number(tradez?.state?.lastScanAt || 0));
  return {
    label: state.perps.scannerEnabled ? "Active" : "Paused",
    note: lastScanAt ? `Last runtime scan ${formatDateTime(lastScanAt)}` : "Waiting for runtime activity",
  };
}

function selectedPerpsSymbol() {
  if (state.perps.selectedSymbol) return state.perps.selectedSymbol;
  const universe = state.perps.runtime.universe || [];
  return universe[0]?.symbol || "";
}

function resolvePerpsSymbolSelection() {
  const universe = Array.isArray(state.perps.runtime.universe) ? state.perps.runtime.universe : [];
  const selected = String(state.perps.selectedSymbol || "").trim().toUpperCase();
  if (selected && universe.some((entry) => entry.symbol === selected)) return selected;

  const query = String(state.perps.selectorQuery || "").trim().toUpperCase();
  if (!query) return selected || universe[0]?.symbol || "";

  const exact = universe.find(
    (entry) =>
      entry.symbol === query ||
      String(entry.baseAsset || "").trim().toUpperCase() === query
  );
  if (exact) return exact.symbol;

  const loose = universe.find((entry) => entry.symbol.startsWith(query));
  return loose?.symbol || selected || universe[0]?.symbol || query;
}

function filteredPerpsUniverse() {
  const query = String(state.perps.selectorQuery || "").trim().toLowerCase();
  const universe = Array.isArray(state.perps.runtime.universe) ? state.perps.runtime.universe : [];
  if (!query) return universe.slice(0, MAX_SUGGESTIONS);
  return universe
    .filter((entry) => {
      const haystack = `${entry.symbol} ${entry.baseAsset || ""}`.toLowerCase();
      return haystack.includes(query);
    })
    .slice(0, MAX_SUGGESTIONS);
}

function filteredDlmmPools() {
  const query = String(state.dlmm.selectorQuery || "").trim().toLowerCase();
  const pools = Array.isArray(state.dlmm.pools) ? state.dlmm.pools : [];
  if (!query) return pools.slice(0, MAX_SUGGESTIONS);
  return pools
    .filter((pool) =>
      `${pool.address} ${pool.pairLabel} ${pool.baseSymbol} ${pool.quoteSymbol}`.toLowerCase().includes(query)
    )
    .slice(0, MAX_SUGGESTIONS);
}

function selectedPool() {
  return (state.dlmm.pools || []).find((pool) => pool.address === state.dlmm.selectedPoolAddress) || null;
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

function buildPerpsManualScanPayload(symbol) {
  const normalized = String(symbol || "").trim().toUpperCase();
  if (!normalized) return null;

  const matchingCall = mergePerpsCalls()
    .filter((call) => call.symbol === normalized)
    .sort((left, right) => (right.openedAt || right.detectedAt || 0) - (left.openedAt || left.detectedAt || 0))[0];
  if (matchingCall) {
    return {
      ok: true,
      symbol: normalized,
      preferred: createPerpsAlertPayload(matchingCall),
      source: matchingCall.engineLabel,
      scannedAt: Date.now(),
    };
  }

  const matchingCandidate = mergePerpsCandidates()
    .filter((candidate) => candidate.symbol === normalized)
    .sort((left, right) => (right.qualityScore || 0) - (left.qualityScore || 0))[0];
  if (matchingCandidate) {
    return {
      ok: true,
      symbol: normalized,
      preferred: createPerpsAlertPayload(matchingCandidate),
      source: matchingCandidate.engineLabel,
      scannedAt: Date.now(),
    };
  }

  return {
    ok: true,
    symbol: normalized,
    preferred: null,
    scannedAt: Date.now(),
    note: "No current House or Tradez candidate matched this pair on the latest runtime scan.",
  };
}

function createDlmmAlertPayload(opportunity) {
  return {
    pair: opportunity.pairLabel,
    pool: opportunity.address,
    strategy: opportunity.analysis.recommendedStrategy,
    binStep: opportunity.binStep,
    suggestedRange: opportunity.analysis.suggestedRange,
    estimatedHoldTime: opportunity.analysis.estimatedHoldTime,
    riskNotes: opportunity.analysis.riskNotes,
    importantParametersToMonitor: opportunity.analysis.monitors,
    confidence: opportunity.analysis.qualityScore,
    qualificationReason: opportunity.analysis.qualificationReasons,
  };
}

async function sendWebhookAlert(moduleKey, title, payload, meta) {
  const webhook = String(state[moduleKey].webhook || "").trim();
  if (!isDiscordWebhook(webhook)) {
    throw new Error("Invalid Discord webhook.");
  }

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

  const response = await postJson("/api/notify", {
    title,
    event,
    meta,
    destinations: {
      discordWebhook: webhook,
    },
  });
  return response;
}

async function testWebhook(moduleKey) {
  try {
    const response = await sendWebhookAlert(
      moduleKey,
      moduleKey === PERPS_MODULE ? "Soloris Perps Alert Test" : "Soloris DLMM Alert Test",
      moduleKey === PERPS_MODULE
        ? {
            pair: selectedPerpsSymbol() || "BTCUSDT",
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
          }
        : {
            pair: selectedPool()?.pairLabel || "SOL/USDC",
            pool: selectedPool()?.address || "manual-test",
            strategy: "Curve",
            binStep: 20,
            suggestedRange: "±10%",
            estimatedHoldTime: "1-3 days",
            riskNotes: ["Webhook validation test"],
            importantParametersToMonitor: ["TVL", "24H volume", "Fee/TVL ratio"],
            confidence: 82,
            qualificationReason: ["Webhook validation test from Playground"],
          },
      {
        source: `playground_${moduleKey}`,
        strategy: moduleKey === PERPS_MODULE ? "perps_alerts" : "dlmm_alerts",
        eventType: "test_signal",
      }
    );
    updateWebhookHealth(moduleKey, "ok", response.ok ? "Webhook test sent." : "Webhook test completed.");
    pushModuleLog(moduleKey, "alertLog", {
      tone: "up",
      message: "Webhook test sent successfully.",
    });
  } catch (error) {
    updateWebhookHealth(moduleKey, "down", error.message || "Webhook test failed.");
    pushModuleLog(moduleKey, "alertLog", {
      tone: "down",
      message: error.message || "Webhook test failed.",
    });
  }
  persistState();
  render();
}

async function syncPerpsScannerState(enabled) {
  try {
    await Promise.allSettled([
      postJson("/api/house-runtime", { action: "settings", settings: { autoEnabled: enabled } }),
      postJson("/api/tradez-runtime", { action: "settings", settings: { autoEnabled: enabled } }),
    ]);
  } catch (_error) {
    // The UI still tracks local scanner state even if a runtime update fails.
  }
}

async function refreshPerpsData({ fullScan = false, source = "manual" } = {}) {
  if (perpsInFlight) return;
  perpsInFlight = true;
  state.perps.loading = true;
  state.perps.lastError = "";
  render();

  try {
    if (fullScan) {
      await Promise.allSettled([
        postJson("/api/house-runtime", { action: "scan" }),
        postJson("/api/tradez-runtime", { action: "scan" }),
      ]);
    }

    const [house, tradez, universe] = await Promise.all([
      fetchJson("/api/house-runtime"),
      fetchJson("/api/tradez-runtime"),
      fetchJson("/api/arena-universe"),
    ]);

    state.perps.runtime.house = house;
    state.perps.runtime.tradez = tradez;
    state.perps.runtime.universe = Array.isArray(universe.tickers) ? universe.tickers : [];
    state.perps.runtime.universeSource = universe.source || "";
    state.perps.runtime.universeWarning = universe.warning || "";
    state.perps.runtime.backgroundAvailable = Boolean(house.backgroundAvailable || tradez.backgroundAvailable);
    state.perps.lastSyncAt = Date.now();

    if (!state.perps.selectedSymbol && state.perps.runtime.universe.length) {
      state.perps.selectedSymbol = state.perps.runtime.universe[0].symbol;
    }

    pushModuleLog(PERPS_MODULE, "scanLog", {
      tone: "neutral",
      message:
        source === "scheduled"
          ? "Scheduled perps refresh completed."
          : fullScan
            ? "Manual perps runtime scan completed."
            : "Perps runtime state refreshed.",
    });

    await maybeSendPerpsAlerts();
    updateHeroHealth();
  } catch (error) {
    state.perps.lastError = error.message || "Unable to refresh perps data.";
    pushModuleLog(PERPS_MODULE, "scanLog", {
      tone: "down",
      message: state.perps.lastError,
    });
  } finally {
    state.perps.loading = false;
    perpsInFlight = false;
    persistState();
    render();
  }
}

async function maybeSendPerpsAlerts() {
  if (!state.perps.scannerEnabled || !isDiscordWebhook(state.perps.webhook)) return;

  const calls = mergePerpsCalls()
    .filter((call) => call.status === "Open" && withinLookback(call.openedAt || call.detectedAt))
    .sort((left, right) => (right.openedAt || right.detectedAt) - (left.openedAt || left.detectedAt));
  const candidates = mergePerpsCandidates()
    .filter((candidate) => candidate.qualityScore >= 70 && withinLookback(candidate.timestamp || Date.now()))
    .sort((left, right) => right.qualityScore - left.qualityScore);

  const outbound = [
    ...calls.map((call) => ({ id: `call:${call.id}`, title: `${call.engineLabel} opened ${call.symbol}`, payload: createPerpsAlertPayload(call) })),
    ...candidates.map((candidate) => ({
      id: `candidate:${candidate.id}`,
      title: `${candidate.engineLabel} qualified ${candidate.symbol}`,
      payload: createPerpsAlertPayload(candidate),
    })),
  ];

  for (const item of outbound) {
    if (state.perps.sentIds.includes(item.id)) continue;
    try {
      await sendWebhookAlert(PERPS_MODULE, item.title, item.payload, {
        source: "playground_perps",
        strategy: "perps_alerts",
        eventType: "scanner_signal",
      });
      pushSentId(PERPS_MODULE, item.id);
      updateWebhookHealth(PERPS_MODULE, "ok", `Last delivery succeeded at ${formatDateTime(Date.now())}`);
      pushModuleLog(PERPS_MODULE, "alertLog", {
        tone: "up",
        message: `${item.title} sent to Discord.`,
      });
    } catch (error) {
      updateWebhookHealth(PERPS_MODULE, "down", error.message || "Discord delivery failed.");
      pushModuleLog(PERPS_MODULE, "alertLog", {
        tone: "down",
        message: error.message || "Discord delivery failed.",
      });
      break;
    }
  }
}

async function runPerpsManualScan() {
  const symbol = resolvePerpsSymbolSelection();
  if (!symbol) return;
  state.perps.loading = true;
  render();
  try {
    await refreshPerpsData({ fullScan: true, source: "manual" });
    const payload = buildPerpsManualScanPayload(symbol);
    state.perps.manualScan = payload;
    state.perps.selectedSymbol = symbol;
    pushModuleLog(PERPS_MODULE, "scanLog", {
      tone: payload?.preferred ? "up" : "neutral",
      message: payload?.preferred
        ? `Manual pair scan completed for ${payload.symbol || symbol}.`
        : `Manual pair scan refreshed ${symbol}, but no current House or Tradez setup matched.`,
    });
  } catch (error) {
    state.perps.lastError = error.message || "Manual pair scan failed.";
    pushModuleLog(PERPS_MODULE, "scanLog", {
      tone: "down",
      message: state.perps.lastError,
    });
  } finally {
    state.perps.loading = false;
    persistState();
    render();
  }
}

function updateDlmmCalls(opportunities) {
  const now = Date.now();
  const current = Array.isArray(state.dlmm.recentCalls) ? state.dlmm.recentCalls : [];
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
          status: "Open",
          detectedAt: now,
          lastSeenAt: now,
          initialEdgeScore: edgeScore,
          currentEdgeScore: edgeScore,
          currentQualityScore: Number(pool.analysis.qualityScore) || 0,
          currentStrategy: pool.analysis.recommendedStrategy,
          currentRange: pool.analysis.suggestedRange,
          estimatedHoldTime: pool.analysis.estimatedHoldTime,
          riskNotes: pool.analysis.riskNotes,
          monitors: pool.analysis.monitors,
          performancePct: 0,
          latestNotes: pool.analysis.qualificationReasons,
          misses: 0,
        });
      }
    });

  current.forEach((call) => {
    if (call.status !== "Open") return;
    if (seen.has(call.address)) return;
    call.misses = Number(call.misses || 0) + 1;
    if (call.misses >= 2) {
      call.status = "Closed";
      call.closedAt = now;
    }
  });

  state.dlmm.recentCalls = current.slice(0, 160);
}

async function maybeSendDlmmAlerts() {
  if (!state.dlmm.scannerEnabled || !isDiscordWebhook(state.dlmm.webhook)) return;
  const newCalls = state.dlmm.recentCalls.filter(
    (call) =>
      call.status === "Open" &&
      withinLookback(call.detectedAt) &&
      !state.dlmm.sentIds.includes(call.id)
  );

  for (const call of newCalls) {
    const payload = createDlmmAlertPayload({
      address: call.address,
      pairLabel: call.pairLabel,
      analysis: {
        recommendedStrategy: call.strategy,
        suggestedRange: call.currentRange,
        estimatedHoldTime: call.estimatedHoldTime,
        riskNotes: call.riskNotes,
        monitors: call.monitors,
        qualityScore: call.currentQualityScore,
        qualificationReasons: call.latestNotes,
      },
      binStep: selectedPool()?.binStep || null,
    });

    try {
      await sendWebhookAlert(DLMM_MODULE, `DLMM opportunity qualified ${call.pairLabel}`, payload, {
        source: "playground_dlmm",
        strategy: "dlmm_alerts",
        eventType: "scanner_signal",
      });
      pushSentId(DLMM_MODULE, call.id);
      updateWebhookHealth(DLMM_MODULE, "ok", `Last delivery succeeded at ${formatDateTime(Date.now())}`);
      pushModuleLog(DLMM_MODULE, "alertLog", {
        tone: "up",
        message: `${call.pairLabel} DLMM alert sent to Discord.`,
      });
    } catch (error) {
      updateWebhookHealth(DLMM_MODULE, "down", error.message || "DLMM Discord delivery failed.");
      pushModuleLog(DLMM_MODULE, "alertLog", {
        tone: "down",
        message: error.message || "DLMM Discord delivery failed.",
      });
      break;
    }
  }
}

async function refreshDlmmData({ source = "manual" } = {}) {
  if (dlmmInFlight) return;
  dlmmInFlight = true;
  state.dlmm.loading = true;
  state.dlmm.lastError = "";
  render();

  try {
    const query = state.dlmm.selectorQuery ? `&query=${encodeURIComponent(state.dlmm.selectorQuery)}` : "";
    const payload = await fetchJson(`/api/playground-dlmm?mode=list&pageSize=150${query}`);
    state.dlmm.pools = Array.isArray(payload.pools) ? payload.pools : [];
    state.dlmm.protocolMetrics = payload.protocolMetrics || null;
    state.dlmm.lastSyncAt = Date.now();

    if ((!state.dlmm.selectedPoolAddress || !state.dlmm.pools.some((pool) => pool.address === state.dlmm.selectedPoolAddress)) && state.dlmm.pools.length) {
      state.dlmm.selectedPoolAddress = state.dlmm.pools[0].address;
    }

    updateDlmmCalls(state.dlmm.pools);
    pushModuleLog(DLMM_MODULE, "scanLog", {
      tone: "neutral",
      message:
        source === "scheduled"
          ? "Scheduled DLMM scanner refresh completed."
          : "DLMM pool state refreshed.",
    });

    await maybeSendDlmmAlerts();
    updateHeroHealth();
  } catch (error) {
    state.dlmm.lastError = error.message || "Unable to refresh DLMM pools.";
    pushModuleLog(DLMM_MODULE, "scanLog", {
      tone: "down",
      message: state.dlmm.lastError,
    });
  } finally {
    state.dlmm.loading = false;
    dlmmInFlight = false;
    persistState();
    render();
  }
}

async function runDlmmManualScan() {
  const poolAddress = state.dlmm.selectedPoolAddress;
  const query = state.dlmm.selectorQuery;
  if (!poolAddress && !query) return;
  state.dlmm.loading = true;
  render();
  try {
    const payload = await postJson("/api/playground-dlmm", {
      action: "scan",
      poolAddress,
      query,
    });
    state.dlmm.manualScan = payload;
    if (payload.pool?.address) state.dlmm.selectedPoolAddress = payload.pool.address;
    pushModuleLog(DLMM_MODULE, "scanLog", {
      tone: "up",
      message: `Detailed DLMM scan completed for ${payload.pool?.pairLabel || payload.pool?.address || query}.`,
    });
  } catch (error) {
    state.dlmm.lastError = error.message || "DLMM manual scan failed.";
    pushModuleLog(DLMM_MODULE, "scanLog", {
      tone: "down",
      message: state.dlmm.lastError,
    });
  } finally {
    state.dlmm.loading = false;
    persistState();
    render();
  }
}

function computeDlmmMetrics() {
  const calls = state.dlmm.recentCalls || [];
  const profitable = calls.filter((call) => Number(call.performancePct) > 0);
  const losing = calls.filter((call) => Number(call.performancePct) < 0);
  const aggregatePerformance =
    calls.length > 0 ? calls.reduce((sum, call) => sum + (Number(call.performancePct) || 0), 0) / calls.length : 0;
  return {
    totalCallsOverall: calls.length,
    totalCallsToday: calls.filter((call) => withinLookback(call.detectedAt)).length,
    profitableCalls: profitable.length,
    losingCalls: losing.length,
    aggregatePerformance,
    activeCalls: calls.filter((call) => call.status === "Open").length,
  };
}

function updateHeroHealth() {
  const perpsHealth = perpsScannerHealthLabel();
  const dlmmHealth = state.dlmm.loading
    ? { label: "Scanning", note: "Refreshing official Meteora pools" }
    : state.dlmm.lastError
      ? { label: "Degraded", note: state.dlmm.lastError }
      : {
          label: state.dlmm.scannerEnabled ? "Active" : "Paused",
          note: state.dlmm.lastSyncAt ? `Last DLMM sync ${formatDateTime(state.dlmm.lastSyncAt)}` : "Waiting for first sync",
        };

  const perpsEl = document.getElementById("playground-hero-perps-health");
  const perpsNoteEl = document.getElementById("playground-hero-perps-note");
  const dlmmEl = document.getElementById("playground-hero-dlmm-health");
  const dlmmNoteEl = document.getElementById("playground-hero-dlmm-note");

  if (perpsEl) perpsEl.textContent = perpsHealth.label;
  if (perpsNoteEl) perpsNoteEl.textContent = perpsHealth.note;
  if (dlmmEl) dlmmEl.textContent = dlmmHealth.label;
  if (dlmmNoteEl) dlmmNoteEl.textContent = dlmmHealth.note;
}

function buildPerpsPreview() {
  if (state.perps.manualScan) {
    const payload = state.perps.manualScan;
    const preferred = payload.preferred;
    if (preferred) {
      return `
        <article class="playground-preview-card">
          <div class="playground-preview-head">
            <div>
              <p class="panel-label">Alert Preview</p>
              <h3>${escapeHtml(payload.symbol)}</h3>
            </div>
            <span class="playground-pill">${escapeHtml(preferred.strategy)}</span>
          </div>
          <div class="playground-preview-grid">
            <div><span>Direction</span><strong>${escapeHtml(preferred.direction)}</strong></div>
            <div><span>Quality</span><strong>Q${formatNumber(preferred.confidence, 0)}</strong></div>
            <div><span>Entry</span><strong>${formatUsd(preferred.entry)}</strong></div>
            <div><span>Stop</span><strong>${formatUsd(preferred.stop)}</strong></div>
            <div><span>Take Profit</span><strong>${formatUsd(preferred.takeProfit)}</strong></div>
            <div><span>RR</span><strong>${formatNumber(preferred.rr, 2)}</strong></div>
          </div>
          <p class="playground-preview-copy">${escapeHtml(preferred.qualificationReason)}</p>
          <pre class="playground-payload-preview">${escapeHtml(JSON.stringify(preferred, null, 2))}</pre>
        </article>
      `;
    }
    return `
      <article class="playground-preview-card playground-empty-card">
        <strong>No qualifying live alert on the latest scan for ${escapeHtml(payload.symbol || selectedPerpsSymbol() || "this pair")}.</strong>
        <span>${escapeHtml(payload.note || "The runtime scan completed, but this pair is not currently qualified by House or Tradez.")}</span>
      </article>
    `;
  }

  const current = mergePerpsCandidates().find((candidate) => candidate.symbol === selectedPerpsSymbol());
  if (!current) {
    return `<article class="playground-preview-card playground-empty-card"><strong>No current alert preview.</strong><span>Run a manual pair scan to inspect the selected symbol with the latest House and Tradez logic.</span></article>`;
  }

  const payload = createPerpsAlertPayload(current);
  return `
    <article class="playground-preview-card">
      <div class="playground-preview-head">
        <div>
          <p class="panel-label">Alert Preview</p>
          <h3>${escapeHtml(current.symbol)}</h3>
        </div>
        <span class="playground-pill">${escapeHtml(current.strategy)}</span>
      </div>
      <div class="playground-preview-grid">
        <div><span>Direction</span><strong>${escapeHtml(current.side)}</strong></div>
        <div><span>Quality</span><strong>Q${formatNumber(current.qualityScore, 0)}</strong></div>
        <div><span>Entry</span><strong>${formatUsd(current.entryPrice)}</strong></div>
        <div><span>Stop</span><strong>${formatUsd(current.stopLoss)}</strong></div>
        <div><span>Take Profit</span><strong>${formatUsd(current.takeProfit)}</strong></div>
        <div><span>RR</span><strong>${formatNumber(current.rr, 2)}</strong></div>
      </div>
      <p class="playground-preview-copy">${escapeHtml(current.qualificationReason)}</p>
      <pre class="playground-payload-preview">${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
    </article>
  `;
}

function buildDlmmPreview() {
  const payload = state.dlmm.manualScan;
  if (!payload?.pool || !payload.analysis) {
    return `<article class="playground-preview-card playground-empty-card"><strong>No detailed pool analysis loaded.</strong><span>Select a DLMM pool and run a manual pool scan to inspect strategy, range, quality, and risk notes.</span></article>`;
  }

  return `
    <article class="playground-preview-card">
      <div class="playground-preview-head">
        <div>
          <p class="panel-label">Detailed Opportunity Analysis</p>
          <h3>${escapeHtml(payload.pool.pairLabel)}</h3>
        </div>
        <span class="playground-pill">${escapeHtml(payload.analysis.recommendedStrategy)}</span>
      </div>
      <div class="playground-preview-grid">
        <div><span>Quality</span><strong>${formatNumber(payload.analysis.qualityScore, 0)}</strong></div>
        <div><span>Bin Step</span><strong>${formatNumber(payload.pool.binStep, 0)}</strong></div>
        <div><span>Range</span><strong>${escapeHtml(payload.analysis.suggestedRange)}</strong></div>
        <div><span>Hold Time</span><strong>${escapeHtml(payload.analysis.estimatedHoldTime)}</strong></div>
        <div><span>TVL</span><strong>${formatCompactUsd(payload.pool.tvl)}</strong></div>
        <div><span>24H Volume</span><strong>${formatCompactUsd(payload.pool.volume24h)}</strong></div>
      </div>
      <p class="playground-preview-copy">${escapeHtml(payload.analysis.summary)}</p>
      <div class="playground-chip-row">
        ${(payload.analysis.qualificationReasons || []).map((item) => `<span class="playground-chip">${escapeHtml(item)}</span>`).join("")}
      </div>
      <div class="playground-detail-block">
        <h4>Risk Notes</h4>
        <ul>${(payload.analysis.riskNotes || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>
      <div class="playground-detail-block">
        <h4>Monitor</h4>
        <ul>${(payload.analysis.monitors || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>
    </article>
  `;
}

function renderMetricCards(metrics, mode) {
  const cards =
    mode === PERPS_MODULE
      ? [
          ["Total Calls Overall", metrics.totalCallsOverall, "Opened + closed calls from House and Tradez"],
          ["Total Calls Today", metrics.totalCallsToday, "Calls opened in the last 24 hours"],
          ["Wins", metrics.wins, "Closed calls with positive return"],
          ["Losses", metrics.losses, "Closed calls with zero or negative return"],
          ["Open Calls", metrics.openCalls, "Currently active runtime positions"],
          ["Profit %", formatPercent(metrics.profitPercentage, 1), "Win rate across closed calls"],
          ["Loss %", formatPercent(metrics.lossPercentage, 1), "Loss rate across closed calls"],
          ["Average RR", formatNumber(metrics.averageRr, 2), "Across all tracked perps calls"],
          ["Average Hold", formatDuration(metrics.averageHold), "Closed call average hold time"],
          ["Best Pairs", bestWorstLabel(metrics.bestPairs), "Highest average return by pair"],
          ["Worst Pairs", bestWorstLabel(metrics.worstPairs), "Lowest average return by pair"],
        ]
      : [
          ["Total Calls Overall", metrics.totalCallsOverall, "Tracked DLMM opportunities surfaced by the scanner"],
          ["Total Calls Today", metrics.totalCallsToday, "Opportunities created in the last 24 hours"],
          ["Profitable Calls", metrics.profitableCalls, "Calls with positive current edge performance"],
          ["Losing Calls", metrics.losingCalls, "Calls with negative current edge performance"],
          ["Aggregate Performance", formatPercent(metrics.aggregatePerformance, 1), "Average edge performance across tracked calls"],
          ["Open / Active Calls", metrics.activeCalls, "Currently qualifying pool opportunities"],
        ];

  return `
    <section class="playground-metric-grid playground-metric-grid--wide">
      ${cards
        .map(
          ([label, value, note]) => `
            <article class="metric-card playground-op-metric">
              <span class="metric-label">${escapeHtml(label)}</span>
              <strong>${escapeHtml(value)}</strong>
              <small>${escapeHtml(note)}</small>
            </article>
          `
        )
        .join("")}
    </section>
  `;
}

function renderSelectorResults(items, type) {
  if (!items.length) {
    return `<div class="playground-selector-empty">No matching ${type === "perps" ? "perps pairs" : "DLMM pools"}.</div>`;
  }
  return `
    <div class="playground-selector-results">
      ${items
        .map((item) =>
          type === "perps"
            ? `<button class="playground-selector-option" type="button" data-select-symbol="${escapeHtml(item.symbol)}">
                <strong>${escapeHtml(item.symbol)}</strong>
                <span>${formatCompactUsd(item.quoteVolume || 0)}</span>
              </button>`
            : `<button class="playground-selector-option" type="button" data-select-pool="${escapeHtml(item.address)}">
                <strong>${escapeHtml(item.pairLabel)}</strong>
                <span>${formatCompactUsd(item.volume24h || 0)}</span>
              </button>`
        )
        .join("")}
    </div>
  `;
}

function renderHealthCards(moduleKey) {
  const moduleState = state[moduleKey];
  const scannerStatus =
    moduleState.loading
      ? "Running"
      : moduleState.lastError
        ? "Degraded"
        : moduleState.scannerEnabled
          ? "Enabled"
          : "Paused";
  const webhook = moduleState.webhookHealth || defaultModuleWebhookHealth();
  const scannerNote =
    moduleKey === PERPS_MODULE
      ? perpsScannerHealthLabel().note
      : moduleState.lastSyncAt
        ? `Last sync ${formatDateTime(moduleState.lastSyncAt)}`
        : "Waiting for first scanner pass";
  const sourceNote =
    moduleKey === PERPS_MODULE
      ? state.perps.runtime.universeSource || "Binance universe"
      : state.dlmm.protocolMetrics
        ? `Meteora TVL ${formatCompactUsd(state.dlmm.protocolMetrics.tvl || 0)}`
        : "Official Meteora pool API";
  const selectedNote =
    moduleKey === PERPS_MODULE
      ? selectedPerpsSymbol() || "No pair selected"
      : selectedPool()?.pairLabel || "No pool selected";
  return `
    <section class="playground-health-grid">
      <article class="playground-health-card">
        <span>Scanner Health</span>
        <strong>${escapeHtml(scannerStatus)}</strong>
        <small>${escapeHtml(scannerNote)}</small>
      </article>
      <article class="playground-health-card">
        <span>Webhook Health</span>
        <strong>${escapeHtml(webhook.status === "ok" ? "Healthy" : webhook.status === "down" ? "Error" : "Idle")}</strong>
        <small>${escapeHtml(webhook.message || "Not tested yet")}</small>
      </article>
      <article class="playground-health-card">
        <span>Data Source</span>
        <strong>${moduleKey === PERPS_MODULE ? "Binance + Runtime" : "Meteora DLMM"}</strong>
        <small>${escapeHtml(sourceNote)}</small>
      </article>
      <article class="playground-health-card">
        <span>Selected</span>
        <strong>${escapeHtml(selectedNote)}</strong>
        <small>${moduleKey === PERPS_MODULE ? "Manual pair analysis target" : "Detailed pool analysis target"}</small>
      </article>
    </section>
  `;
}

function renderPerpsTable(calls) {
  if (!calls.length) {
    return `<div class="playground-empty-card"><strong>No perps calls recorded yet.</strong><span>Runtime calls will appear here as House and Tradez open or close positions.</span></div>`;
  }
  const rows = calls
    .sort((left, right) => (right.openedAt || right.detectedAt || 0) - (left.openedAt || left.detectedAt || 0))
    .slice(0, 20)
    .map(
      (call) => `
        <tr>
          <td>${escapeHtml(call.symbol)}</td>
          <td>${escapeHtml(call.engineLabel)}</td>
          <td>${escapeHtml(call.side)}</td>
          <td>${escapeHtml(call.status)}</td>
          <td>Q${formatNumber(call.qualityScore, 0)}</td>
          <td>${formatNumber(call.rr, 2)}</td>
          <td>${formatPercent(call.returnPct ?? 0, 1)}</td>
          <td>${formatDateTime(call.openedAt || call.detectedAt)}</td>
          <td>
            <details class="playground-row-detail">
              <summary>Details</summary>
              <div class="playground-row-detail-body">
                <p><strong>Strategy:</strong> ${escapeHtml(call.strategy)}</p>
                <p><strong>Entry:</strong> ${formatUsd(call.entryPrice)} · <strong>Stop:</strong> ${formatUsd(call.stopLoss)} · <strong>TP:</strong> ${formatUsd(call.takeProfit)}</p>
                <p><strong>Timeframe:</strong> ${escapeHtml(call.timeframe)} · <strong>Hold:</strong> ${formatDuration(call.holdMs)}</p>
                <p>${escapeHtml(call.qualificationReason)}</p>
              </div>
            </details>
          </td>
        </tr>
      `
    )
    .join("");
  return `
    <div class="playground-table-wrap">
      <table class="playground-table">
        <thead>
          <tr>
            <th>Pair</th>
            <th>Engine</th>
            <th>Side</th>
            <th>Status</th>
            <th>Quality</th>
            <th>RR</th>
            <th>Return</th>
            <th>Opened</th>
            <th>Analysis</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderDlmmTable(calls) {
  if (!calls.length) {
    return `<div class="playground-empty-card"><strong>No DLMM calls recorded yet.</strong><span>Scanner-qualified Meteora opportunities will appear here as the pool monitor cycles.</span></div>`;
  }
  const rows = calls
    .slice(0, 20)
    .map(
      (call) => `
        <tr>
          <td>${escapeHtml(call.pairLabel)}</td>
          <td>${escapeHtml(call.currentStrategy || call.strategy)}</td>
          <td>${escapeHtml(call.status)}</td>
          <td>${formatNumber(call.currentQualityScore, 0)}</td>
          <td>${formatPercent(call.performancePct, 1)}</td>
          <td>${formatDateTime(call.detectedAt)}</td>
          <td>
            <details class="playground-row-detail">
              <summary>Details</summary>
              <div class="playground-row-detail-body">
                <p><strong>Range:</strong> ${escapeHtml(call.currentRange || "—")} · <strong>Hold:</strong> ${escapeHtml(call.estimatedHoldTime || "—")}</p>
                <p><strong>Risk:</strong> ${escapeHtml((call.riskNotes || []).join(" • ") || "No risk notes")}</p>
                <p><strong>Monitor:</strong> ${escapeHtml((call.monitors || []).join(" • ") || "No monitor list")}</p>
                <p><strong>Qualification:</strong> ${escapeHtml((call.latestNotes || []).join(" • ") || "Current pool scan qualifies")}</p>
              </div>
            </details>
          </td>
        </tr>
      `
    )
    .join("");
  return `
    <div class="playground-table-wrap">
      <table class="playground-table">
        <thead>
          <tr>
            <th>Pool</th>
            <th>Strategy</th>
            <th>Status</th>
            <th>Quality</th>
            <th>Performance</th>
            <th>Detected</th>
            <th>Analysis</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderLogList(entries, emptyText) {
  if (!entries.length) {
    return `<div class="playground-empty-card"><strong>${escapeHtml(emptyText)}</strong></div>`;
  }
  return `
    <div class="playground-log-list">
      ${entries
        .slice(0, 12)
        .map(
          (entry) => `
            <article class="playground-log-item ${entry.tone === "down" ? "is-down" : entry.tone === "up" ? "is-up" : ""}">
              <span>${formatDateTime(entry.time)}</span>
              <p>${escapeHtml(entry.message)}</p>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function buildPerpsReport() {
  const calls = mergePerpsCalls();
  const metrics = computePerpsMetrics(calls);
  return {
    exportedAt: new Date().toISOString(),
    module: "perps_alerts",
    metrics,
    recentCalls: calls.filter((call) => withinLookback(call.openedAt || call.detectedAt)).slice(0, 80),
    scanLog: state.perps.scanLog.filter((entry) => withinLookback(entry.time)),
    alertLog: state.perps.alertLog.filter((entry) => withinLookback(entry.time)),
    manualScan: state.perps.manualScan,
  };
}

function buildDlmmReport() {
  const metrics = computeDlmmMetrics();
  return {
    exportedAt: new Date().toISOString(),
    module: "dlmm_alerts",
    metrics,
    recentCalls: state.dlmm.recentCalls.filter((call) => withinLookback(call.detectedAt || call.lastSeenAt)).slice(0, 80),
    scanLog: state.dlmm.scanLog.filter((entry) => withinLookback(entry.time)),
    alertLog: state.dlmm.alertLog.filter((entry) => withinLookback(entry.time)),
    manualScan: state.dlmm.manualScan,
    protocolMetrics: state.dlmm.protocolMetrics,
  };
}

function renderPerpsModule() {
  const metrics = computePerpsMetrics(mergePerpsCalls());
  const candidates = mergePerpsCandidates();
  const selected = selectedPerpsSymbol();
  const currentSelection = state.perps.runtime.universe.find((entry) => entry.symbol === selected) || null;
  return `
    <div class="playground-module-stack">
      <section class="playground-ops-controls">
        <div class="playground-field-group">
          <label class="playground-control-label" for="playground-perps-query">Perps Selector</label>
          <input id="playground-perps-query" class="playground-input" type="search" placeholder="Search Binance USDT perps" value="${escapeHtml(state.perps.selectorQuery)}" />
          ${renderSelectorResults(filteredPerpsUniverse(), "perps")}
        </div>
        <div class="playground-field-group playground-field-group--compact">
          <label class="playground-control-label" for="playground-perps-interval">Scan Interval</label>
          <select id="playground-perps-interval" class="playground-input">
            ${PERPS_SCAN_INTERVAL_OPTIONS.map((item) => `<option value="${item.value}"${Number(item.value) === Number(state.perps.scanIntervalMs) ? " selected" : ""}>${item.label}</option>`).join("")}
          </select>
        </div>
        <div class="playground-field-group playground-field-group--compact">
          <label class="playground-control-label" for="playground-perps-webhook">Discord Webhook</label>
          <input id="playground-perps-webhook" class="playground-input" type="url" placeholder="https://discord.com/api/webhooks/..." value="${escapeHtml(state.perps.webhook)}" />
        </div>
        <div class="playground-button-row">
          <button class="playground-primary-button" type="button" data-playground-action="toggle-perps-scanner">${state.perps.scannerEnabled ? "Disable Scanner" : "Enable Scanner"}</button>
          <button class="playground-secondary-button" type="button" data-playground-action="scan-perps-pair">Manual Pair Scan</button>
          <button class="playground-secondary-button" type="button" data-playground-action="run-perps-full-scan">Run Full Scan</button>
          <button class="playground-secondary-button" type="button" data-playground-action="test-perps-webhook">Webhook Test</button>
          <button class="playground-secondary-button" type="button" data-playground-action="export-perps-report">Download 24H Report</button>
        </div>
        <div class="playground-control-note">
          Selected pair: <strong>${escapeHtml(selected || "—")}</strong>${currentSelection ? ` · 24H quote volume ${formatCompactUsd(currentSelection.quoteVolume || 0)}` : ""}
        </div>
      </section>

      ${renderHealthCards(PERPS_MODULE)}
      ${renderMetricCards(metrics, PERPS_MODULE)}

      <section class="playground-module-grid">
        <div class="playground-column-stack">
          ${buildPerpsPreview()}
          <article class="playground-section-card">
            <div class="playground-section-head">
              <div>
                <p class="panel-label">Recent Calls</p>
                <h3>Recent perps calls table</h3>
              </div>
            </div>
            ${renderPerpsTable(mergePerpsCalls())}
          </article>
        </div>
        <div class="playground-column-stack">
          <article class="playground-section-card">
            <div class="playground-section-head">
              <div>
                <p class="panel-label">Recent Scan Log</p>
                <h3>Scanner activity</h3>
              </div>
            </div>
            ${renderLogList(state.perps.scanLog, "No perps scan events yet.")}
          </article>
          <article class="playground-section-card">
            <div class="playground-section-head">
              <div>
                <p class="panel-label">Recent Alert Log</p>
                <h3>Discord and workstation alerts</h3>
              </div>
            </div>
            ${renderLogList(state.perps.alertLog, "No perps alerts have been sent yet.")}
          </article>
          <article class="playground-section-card">
            <div class="playground-section-head">
              <div>
                <p class="panel-label">Qualified Right Now</p>
                <h3>Current scanner candidates</h3>
              </div>
            </div>
            ${
              candidates.length
                ? `<div class="playground-chip-row">${candidates.slice(0, 12).map((candidate) => `<span class="playground-chip">${escapeHtml(candidate.symbol)} · ${escapeHtml(candidate.strategy)} · Q${formatNumber(candidate.qualityScore, 0)}</span>`).join("")}</div>`
                : `<div class="playground-empty-card"><strong>No live perps candidates right now.</strong></div>`
            }
          </article>
        </div>
      </section>
    </div>
  `;
}

function renderDlmmModule() {
  const metrics = computeDlmmMetrics();
  const selected = selectedPool();
  return `
    <div class="playground-module-stack">
      <section class="playground-ops-controls">
        <div class="playground-field-group">
          <label class="playground-control-label" for="playground-dlmm-query">DLMM Selector</label>
          <input id="playground-dlmm-query" class="playground-input" type="search" placeholder="Search Meteora DLMM pools" value="${escapeHtml(state.dlmm.selectorQuery)}" />
          ${renderSelectorResults(filteredDlmmPools(), "dlmm")}
        </div>
        <div class="playground-field-group playground-field-group--compact">
          <label class="playground-control-label" for="playground-dlmm-interval">Scan Interval</label>
          <select id="playground-dlmm-interval" class="playground-input">
            ${DLMM_SCAN_INTERVAL_OPTIONS.map((item) => `<option value="${item.value}"${Number(item.value) === Number(state.dlmm.scanIntervalMs) ? " selected" : ""}>${item.label}</option>`).join("")}
          </select>
        </div>
        <div class="playground-field-group playground-field-group--compact">
          <label class="playground-control-label" for="playground-dlmm-webhook">Discord Webhook</label>
          <input id="playground-dlmm-webhook" class="playground-input" type="url" placeholder="https://discord.com/api/webhooks/..." value="${escapeHtml(state.dlmm.webhook)}" />
        </div>
        <div class="playground-button-row">
          <button class="playground-primary-button" type="button" data-playground-action="toggle-dlmm-scanner">${state.dlmm.scannerEnabled ? "Disable Scanner" : "Enable Scanner"}</button>
          <button class="playground-secondary-button" type="button" data-playground-action="scan-dlmm-pool">Manual Pool Scan</button>
          <button class="playground-secondary-button" type="button" data-playground-action="refresh-dlmm">Refresh Pools</button>
          <button class="playground-secondary-button" type="button" data-playground-action="test-dlmm-webhook">Webhook Test</button>
          <button class="playground-secondary-button" type="button" data-playground-action="export-dlmm-report">Download 24H Report</button>
        </div>
        <div class="playground-control-note">
          Selected pool: <strong>${escapeHtml(selected?.pairLabel || selected?.address || "—")}</strong>
        </div>
      </section>

      ${renderHealthCards(DLMM_MODULE)}
      ${renderMetricCards(metrics, DLMM_MODULE)}

      <section class="playground-module-grid">
        <div class="playground-column-stack">
          ${buildDlmmPreview()}
          <article class="playground-section-card">
            <div class="playground-section-head">
              <div>
                <p class="panel-label">Recent Calls</p>
                <h3>Tracked DLMM opportunities</h3>
              </div>
            </div>
            ${renderDlmmTable(state.dlmm.recentCalls)}
          </article>
        </div>
        <div class="playground-column-stack">
          <article class="playground-section-card">
            <div class="playground-section-head">
              <div>
                <p class="panel-label">Recent Scan Log</p>
                <h3>Scanner activity</h3>
              </div>
            </div>
            ${renderLogList(state.dlmm.scanLog, "No DLMM scan events yet.")}
          </article>
          <article class="playground-section-card">
            <div class="playground-section-head">
              <div>
                <p class="panel-label">Recent Alert Log</p>
                <h3>Discord and workstation alerts</h3>
              </div>
            </div>
            ${renderLogList(state.dlmm.alertLog, "No DLMM alerts have been sent yet.")}
          </article>
          <article class="playground-section-card">
            <div class="playground-section-head">
              <div>
                <p class="panel-label">Live Opportunity Feed</p>
                <h3>Top qualifying pools</h3>
              </div>
            </div>
            ${
              state.dlmm.pools.filter((pool) => pool.analysis?.qualifies).length
                ? `<div class="playground-chip-row">${state.dlmm.pools.filter((pool) => pool.analysis?.qualifies).slice(0, 12).map((pool) => `<span class="playground-chip">${escapeHtml(pool.pairLabel)} · ${escapeHtml(pool.analysis.recommendedStrategy)} · ${formatNumber(pool.analysis.qualityScore, 0)}</span>`).join("")}</div>`
                : `<div class="playground-empty-card"><strong>No qualifying DLMM opportunities right now.</strong></div>`
            }
          </article>
        </div>
      </section>
    </div>
  `;
}

function render() {
  updateHeroHealth();
  document.querySelectorAll("[data-module-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.moduleTab === state.activeModule);
  });

  const content = document.getElementById("playground-content");
  if (!content) return;
  content.innerHTML = state.activeModule === PERPS_MODULE ? renderPerpsModule() : renderDlmmModule();
}

function handleTopTabClick(target) {
  const tab = target.closest("[data-module-tab]");
  if (!tab) return false;
  state.activeModule = tab.dataset.moduleTab === DLMM_MODULE ? DLMM_MODULE : PERPS_MODULE;
  persistState();
  render();
  return true;
}

function handleSelectorChoice(target) {
  const symbolButton = target.closest("[data-select-symbol]");
  if (symbolButton) {
    state.perps.selectedSymbol = symbolButton.dataset.selectSymbol || "";
    state.perps.selectorQuery = state.perps.selectedSymbol;
    persistState();
    render();
    return true;
  }
  const poolButton = target.closest("[data-select-pool]");
  if (poolButton) {
    state.dlmm.selectedPoolAddress = poolButton.dataset.selectPool || "";
    const pool = selectedPool();
    state.dlmm.selectorQuery = pool?.pairLabel || state.dlmm.selectedPoolAddress;
    persistState();
    render();
    return true;
  }
  return false;
}

async function handleActionClick(target) {
  const actionButton = target.closest("[data-playground-action]");
  if (!actionButton) return false;
  const action = actionButton.dataset.playgroundAction;

  if (action === "toggle-perps-scanner") {
    state.perps.scannerEnabled = !state.perps.scannerEnabled;
    await syncPerpsScannerState(state.perps.scannerEnabled);
    schedulePerpsScanner();
    pushModuleLog(PERPS_MODULE, "scanLog", {
      tone: state.perps.scannerEnabled ? "up" : "neutral",
      message: state.perps.scannerEnabled ? "Perps scanner enabled." : "Perps scanner disabled.",
    });
    persistState();
    render();
    return true;
  }

  if (action === "scan-perps-pair") {
    await runPerpsManualScan();
    return true;
  }

  if (action === "run-perps-full-scan") {
    await refreshPerpsData({ fullScan: true, source: "manual" });
    return true;
  }

  if (action === "test-perps-webhook") {
    await testWebhook(PERPS_MODULE);
    return true;
  }

  if (action === "export-perps-report") {
    downloadJsonFile(
      buildPerpsReport(),
      `soloris-perps-alerts-24h-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
    );
    return true;
  }

  if (action === "toggle-dlmm-scanner") {
    state.dlmm.scannerEnabled = !state.dlmm.scannerEnabled;
    scheduleDlmmScanner();
    pushModuleLog(DLMM_MODULE, "scanLog", {
      tone: state.dlmm.scannerEnabled ? "up" : "neutral",
      message: state.dlmm.scannerEnabled ? "DLMM scanner enabled." : "DLMM scanner disabled.",
    });
    persistState();
    render();
    return true;
  }

  if (action === "scan-dlmm-pool") {
    await runDlmmManualScan();
    return true;
  }

  if (action === "refresh-dlmm") {
    await refreshDlmmData({ source: "manual" });
    return true;
  }

  if (action === "test-dlmm-webhook") {
    await testWebhook(DLMM_MODULE);
    return true;
  }

  if (action === "export-dlmm-report") {
    downloadJsonFile(
      buildDlmmReport(),
      `soloris-dlmm-alerts-24h-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
    );
    return true;
  }

  return false;
}

function handleInputChange(target) {
  if (target.id === "playground-perps-query") {
    state.perps.selectorQuery = target.value;
    persistState();
    render();
    return true;
  }
  if (target.id === "playground-perps-webhook") {
    state.perps.webhook = target.value.trim();
    persistState();
    return true;
  }
  if (target.id === "playground-dlmm-query") {
    state.dlmm.selectorQuery = target.value;
    persistState();
    render();
    return true;
  }
  if (target.id === "playground-dlmm-webhook") {
    state.dlmm.webhook = target.value.trim();
    persistState();
    return true;
  }
  return false;
}

function handleSelectChange(target) {
  if (target.id === "playground-perps-interval") {
    state.perps.scanIntervalMs = Number(target.value) || PERPS_SCAN_INTERVAL_OPTIONS[1].value;
    persistState();
    schedulePerpsScanner();
    render();
    return true;
  }
  if (target.id === "playground-dlmm-interval") {
    state.dlmm.scanIntervalMs = Number(target.value) || DLMM_SCAN_INTERVAL_OPTIONS[1].value;
    persistState();
    scheduleDlmmScanner();
    render();
    return true;
  }
  return false;
}

function bindEvents() {
  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (handleTopTabClick(target)) return;
    if (handleSelectorChoice(target)) return;
    await handleActionClick(target);
  });

  document.addEventListener("input", (event) => {
    handleInputChange(event.target);
  });

  document.addEventListener("change", (event) => {
    handleSelectChange(event.target);
  });
}

async function init() {
  bindEvents();
  render();
  await Promise.allSettled([
    refreshPerpsData({ source: "init" }),
    refreshDlmmData({ source: "init" }),
  ]);
  schedulePerpsScanner();
  scheduleDlmmScanner();
}

document.addEventListener("DOMContentLoaded", () => {
  init();
});
