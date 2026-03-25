const DEFAULT_TOKEN = "BTC";
const STRATEGY_INTERVAL = "1h";
const QUOTE_ASSET = "USDT";
const DEFAULT_QUALITY_THRESHOLD = 78;
const AUTO_SCAN_MS = 5 * 60 * 1000;
const REMOTE_RUNTIME_POLL_MS = 60 * 1000;
const REMOTE_DISPLAY_REFRESH_MS = 2 * 60 * 1000;
const PRIORITY_SCAN_COUNT = 12;
const ROTATION_SCAN_COUNT = 20;
const ANALYSIS_CONCURRENCY = 5;
const STORAGE_KEY = "apex-signals-tradez-state";
const ALERT_EVENTS_KEY = "apex-signals-tradez-alert-events";
const SIGNAL_IDS_KEY = "apex-signals-tradez-seen-signal-ids";
const TICKER_STORAGE_KEY = "apex-signals-tradez-tickers";
const ALERT_CHANNEL_STORAGE_KEY = "apex-signals-alert-channels";
const HOUSE_AUTO_STORAGE_KEY = "apex-signals-auto-paper";
const TRADEZ_AUTO_STORAGE_KEY = "hyperdrive-tradez-auto-paper";
const TRADEZ_EXECUTION_STORAGE_KEY = "soloris-tradez-execution";
const AUTO_TRADE2_RESET_KEY = "soloris-reset-autotrade2-20260322-v2";
const AUTO_TRADE_COMPARE_RESET_KEY = "soloris-reset-house-compare-20260322-v2";
const TRADEZ_EXECUTION_PREFERENCES_VERSION = 5;
const HOUSE_AUTO_STRATEGY_VERSION = 5;
const PAPER_BACKUP_TYPE = "soloris-paper-books-backup";
const PAPER_BACKUP_VERSION = 1;
const REPORT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const UTC_DAY_MS = 24 * 60 * 60 * 1000;
const TRADEZ_AUTO_START_BALANCE = 1000;
const TRADEZ_AUTO_LEVERAGE = 5;
const TRADEZ_AUTO_MAX_CONCURRENT_TRADES = 30;
const TRADEZ_AUTO_MAX_NEW_TRADES = 12;
const TRADEZ_AUTO_VERSION = 5;
const TRADEZ_AUTO_TRADE_COOLDOWN_MS = 4 * 60 * 1000;
const TRADEZ_AUTO_TP1_MARGIN_TRIGGER_PCT = 25;
const TICKER_CACHE_MAX_AGE_MS = 30 * 60 * 1000;
const FRESH_SIGNAL_WINDOW_MS = 10 * 60 * 1000;
const DEMO_STATUS_SYNC_BATCH = 20;
const HIGHER_TIMEFRAME_INTERVAL = "4h";
const EMA_SLOPE_LOOKBACK = 4;
const MIN_EMA_SEPARATION_ATR = 0.2;
const MAX_STALE_SIGNAL_BARS = 2;
const MAX_AUTO_ENTRY_SIGNAL_BARS = 2;
const MAX_POST_TOUCH_EXTENSION_ATR = 1.5;
const MIN_VISIBLE_SIGNAL_RR = 1.2;
const MIN_EXECUTION_RR = 1.25;
const MIN_VISIBLE_SIGNAL_VOLUME_FACTOR = 1.05;
const MIN_AUTO_EXECUTION_VOLUME_FACTOR = 1.03;
const STRICT_LEVEL_TOUCH_BUFFER_ATR = 0.05;
const STRICT_LEVEL_RECLAIM_BUFFER_ATR = 0.04;
const MAX_EXECUTION_DISTANCE_FROM_TOUCH_ATR = 0.6;
const LIVE_ENTRY_BUFFER_ATR = 0.35;
const TRADEZ_AUTO_EXECUTION_THRESHOLD_BUFFER = 5;
const TRADEZ_AUTO_MIN_EXECUTION_THRESHOLD = 84;
const DEFAULT_ALERT_CHANNELS = {
  browser: true,
  discordWebhook: "",
  telegramToken: "",
  telegramChatId: "",
  emailTo: "",
};
const DEFAULT_TRADEZ_EXECUTION = {
  mode: "demo",
  notifyEntries: true,
  notifyExits: true,
};
const LEGACY_TRADEZ_SIGNAL_TEMPLATE = `{title}
Pair: {symbol}
Side: {side}
Entry: {entry}
TP1: {tp1}
TP2: {tp2}
SL: {sl}
Leverage: {leverage}x
Quality: Q{quality}
Touch: {touch}
Detected: {detectedAt}
Mode: {mode}`;
const PREVIOUS_TRADEZ_SIGNAL_TEMPLATE = `{title}
Pair: {symbol}
Side: {side}
Entry: {entry}
Entry Zone: {entryZone}
TP1: {tp1}
TP2: {tp2}
SL: {sl}
Leverage: {leverage}x
Quality: Q{quality}
Touch: {touch}
First detected: {firstDetectedAt}
Alerted: {alertedAt}
Mode: {mode}
Binance: {binanceLink}`;
const DEFAULT_TRADEZ_SIGNAL_TEMPLATE = `{title}
Pair: {symbol}
Side: {side}
Entry: {entry}
Entry Zone: {entryZone}
TP1: {tp1}
TP2: {tp2}
SL: {sl}
Leverage: {leverage}x
Quality: Q{quality}
Touch: {touch}
First detected: {firstDetectedAt}
Opened: {openedAt}
Mode: {mode}
Open on Binance: {binanceLink}`;

const dom = {
  form: document.getElementById("tradez-form"),
  tokenInput: document.getElementById("tradez-token-input"),
  qualityThreshold: document.getElementById("tradez-quality-threshold"),
  refreshSubmit: document.getElementById("tradez-refresh-submit"),
  scanButton: document.getElementById("tradez-scan-button"),
  alertPermissionButton: document.getElementById("tradez-alert-permission"),
  reportExportButton: document.getElementById("tradez-report-export"),
  backupExportButton: document.getElementById("tradez-backup-export"),
  backupImportButton: document.getElementById("tradez-backup-import"),
  backupFileInput: document.getElementById("tradez-backup-file"),
  autoNote: document.getElementById("tradez-auto-note"),
  statusBanner: document.getElementById("tradez-status-banner"),
  metricSelected: document.getElementById("tradez-metric-selected"),
  metricSelectedNote: document.getElementById("tradez-metric-selected-note"),
  metricQualified: document.getElementById("tradez-metric-qualified"),
  metricQualifiedNote: document.getElementById("tradez-metric-qualified-note"),
  metricBullish: document.getElementById("tradez-metric-bullish"),
  metricBullishNote: document.getElementById("tradez-metric-bullish-note"),
  metricBearish: document.getElementById("tradez-metric-bearish"),
  metricBearishNote: document.getElementById("tradez-metric-bearish-note"),
  metricAlerts: document.getElementById("tradez-metric-alerts"),
  metricAlertsNote: document.getElementById("tradez-metric-alerts-note"),
  metricLastScan: document.getElementById("tradez-metric-last-scan"),
  metricLastScanNote: document.getElementById("tradez-metric-last-scan-note"),
  assetTitle: document.getElementById("tradez-asset-title"),
  assetSubtitle: document.getElementById("tradez-asset-subtitle"),
  headlinePrice: document.getElementById("tradez-headline-price"),
  headlineChange: document.getElementById("tradez-headline-change"),
  headlineBias: document.getElementById("tradez-headline-bias"),
  chart: document.getElementById("tradez-chart"),
  chartEma20: document.getElementById("tradez-chart-ema20"),
  chartEma50: document.getElementById("tradez-chart-ema50"),
  chartRsi: document.getElementById("tradez-chart-rsi"),
  chartVolume: document.getElementById("tradez-chart-volume"),
  chartLineLabelEma20: document.getElementById("tradez-chart-line-label-ema20"),
  chartLineLabelEma50: document.getElementById("tradez-chart-line-label-ema50"),
  supportFields: document.getElementById("tradez-support-fields"),
  resistanceFields: document.getElementById("tradez-resistance-fields"),
  qualityBadge: document.getElementById("tradez-quality-badge"),
  qualityMeter: document.getElementById("tradez-quality-meter"),
  qualityLabel: document.getElementById("tradez-quality-label"),
  streamStatus: document.getElementById("tradez-stream-status"),
  summaryCopy: document.getElementById("tradez-summary-copy"),
  stancePill: document.getElementById("tradez-stance-pill"),
  entryZone: document.getElementById("tradez-entry-zone"),
  stop: document.getElementById("tradez-stop"),
  tp1: document.getElementById("tradez-tp1"),
  tp2: document.getElementById("tradez-tp2"),
  tradeSummary: document.getElementById("tradez-trade-summary"),
  planNote: document.getElementById("tradez-plan-note"),
  signalList: document.getElementById("tradez-signal-list"),
  workspaceTabLive: document.getElementById("tradez-workspace-tab-live"),
  workspaceTabCompare: document.getElementById("tradez-workspace-tab-compare"),
  workspaceNote: document.getElementById("tradez-workspace-note"),
  workspacePanelLive: document.getElementById("tradez-workspace-panel-live"),
  workspacePanelCompare: document.getElementById("tradez-workspace-panel-compare"),
  tabSignals: document.getElementById("tradez-tab-signals"),
  tabAlerts: document.getElementById("tradez-tab-alerts"),
  tabNotes: document.getElementById("tradez-tab-notes"),
  tabNote: document.getElementById("tradez-tab-note"),
  panelSignals: document.getElementById("tradez-panel-signals"),
  panelAlerts: document.getElementById("tradez-panel-alerts"),
  panelNotes: document.getElementById("tradez-panel-notes"),
  signalTable: document.getElementById("tradez-signal-table"),
  alertTable: document.getElementById("tradez-alert-table"),
  notesGrid: document.getElementById("tradez-notes-grid"),
  compareGrid: document.getElementById("tradez-compare-grid"),
  auto2Toggle: document.getElementById("tradez-auto2-toggle"),
  auto2Reset: document.getElementById("tradez-auto2-reset"),
  auto2Note: document.getElementById("tradez-auto2-note"),
  deliveryForm: document.getElementById("tradez-delivery-form"),
  deliveryNote: document.getElementById("tradez-delivery-note"),
  alertBrowserEnabled: document.getElementById("tradez-alert-browser-enabled"),
  alertDiscordWebhook: document.getElementById("tradez-alert-discord-webhook"),
  alertTelegramToken: document.getElementById("tradez-alert-telegram-token"),
  alertTelegramChatId: document.getElementById("tradez-alert-telegram-chat-id"),
  alertTemplate: document.getElementById("tradez-alert-template"),
  alertTestButton: document.getElementById("tradez-alert-test"),
  auto2NotifyEntries: document.getElementById("tradez-auto2-notify-entries"),
  auto2NotifyExits: document.getElementById("tradez-auto2-notify-exits"),
  auto2MetricStart: document.getElementById("tradez-auto2-metric-start"),
  auto2MetricEquity: document.getElementById("tradez-auto2-metric-equity"),
  auto2MetricEquityNote: document.getElementById("tradez-auto2-metric-equity-note"),
  auto2MetricRealized: document.getElementById("tradez-auto2-metric-realized"),
  auto2MetricRealizedNote: document.getElementById("tradez-auto2-metric-realized-note"),
  auto2MetricWinRate: document.getElementById("tradez-auto2-metric-winrate"),
  auto2MetricWinRateNote: document.getElementById("tradez-auto2-metric-winrate-note"),
  auto2MetricOpen: document.getElementById("tradez-auto2-metric-open"),
  auto2MetricOpenNote: document.getElementById("tradez-auto2-metric-open-note"),
  auto2MetricLastScan: document.getElementById("tradez-auto2-metric-last-scan"),
  auto2MetricLastScanNote: document.getElementById("tradez-auto2-metric-last-scan-note"),
  auto2TabPositions: document.getElementById("tradez-auto2-tab-positions"),
  auto2TabTrades: document.getElementById("tradez-auto2-tab-trades"),
  auto2TabDemo: document.getElementById("tradez-auto2-tab-demo"),
  auto2TabActivity: document.getElementById("tradez-auto2-tab-activity"),
  auto2TabNote: document.getElementById("tradez-auto2-tab-note"),
  auto2PanelPositions: document.getElementById("tradez-auto2-panel-positions"),
  auto2PanelTrades: document.getElementById("tradez-auto2-panel-trades"),
  auto2PanelDemo: document.getElementById("tradez-auto2-panel-demo"),
  auto2PanelActivity: document.getElementById("tradez-auto2-panel-activity"),
  auto2OpenGrid: document.getElementById("tradez-auto2-open-grid"),
  auto2TradeTable: document.getElementById("tradez-auto2-trade-table"),
  auto2DemoTable: document.getElementById("tradez-auto2-demo-table"),
  auto2ActivityTable: document.getElementById("tradez-auto2-activity-table"),
};

function maybeForceAutoTrade2Reset() {
  if (localStorage.getItem(AUTO_TRADE2_RESET_KEY) === "done") return;
  localStorage.removeItem(TRADEZ_AUTO_STORAGE_KEY);
  localStorage.setItem(AUTO_TRADE2_RESET_KEY, "done");
}

function maybeForceHouseCompareReset() {
  if (localStorage.getItem(AUTO_TRADE_COMPARE_RESET_KEY) === "done") return;
  localStorage.removeItem(HOUSE_AUTO_STORAGE_KEY);
  localStorage.setItem(AUTO_TRADE_COMPARE_RESET_KEY, "done");
}

maybeForceHouseCompareReset();
maybeForceAutoTrade2Reset();

const state = loadState();
const tradezPaper = loadTradezPaperState();
const tradezDelivery = loadTradezDeliveryState();

let chart;
let candleSeries;
let volumeSeries;
let ema20LineSeries;
let ema50LineSeries;
let priceLines = [];
let scanTimer = null;
let scanCursor = 0;
let exchangeInfoCache = null;
let perpUniverseCache = null;
let universeTickerMap = new Map();
let candidateMap = new Map();
let latestBatchMap = new Map();
let chartResizeBound = false;
let remoteRuntimeEnabled = false;
let remoteRuntimeHydrating = false;
let remoteRuntimePollTimer = null;
let remoteDisplayRefreshTimer = null;

function loadTradezPaperState() {
  const stored = readStoredJson(TRADEZ_AUTO_STORAGE_KEY, {});
  return {
    startingBalance: Number(stored.startingBalance) || TRADEZ_AUTO_START_BALANCE,
    balance: Number(stored.balance) || Number(stored.startingBalance) || TRADEZ_AUTO_START_BALANCE,
    autoEnabled: stored.autoEnabled !== false,
    openTrades: Array.isArray(stored.openTrades) ? stored.openTrades : [],
    closedTrades: Array.isArray(stored.closedTrades) ? stored.closedTrades : [],
    demoOrders: Array.isArray(stored.demoOrders) ? stored.demoOrders : [],
    activity: Array.isArray(stored.activity) ? stored.activity : [],
    activeTab: stored.activeTab || "positions",
    lastScanAt: Number(stored.lastScanAt) || 0,
    lastDailyBriefingUtcDate: stored.lastDailyBriefingUtcDate || utcDayKey(Date.now() - UTC_DAY_MS),
    strategyVersion: Number(stored.strategyVersion) || 1,
  };
}

function loadTradezDeliveryState() {
  const stored = readStoredJson(TRADEZ_EXECUTION_STORAGE_KEY, {});
  const sharedChannels = readStoredJson(ALERT_CHANNEL_STORAGE_KEY, {});
  const storedVersion = Number(stored?.preferencesVersion) || 0;
  const storedTemplate = String(stored?.template || "");
  const useFreshTemplate =
    !storedTemplate.trim() ||
    (storedVersion < TRADEZ_EXECUTION_PREFERENCES_VERSION &&
      (storedTemplate.trim() === LEGACY_TRADEZ_SIGNAL_TEMPLATE.trim() ||
        storedTemplate.trim() === PREVIOUS_TRADEZ_SIGNAL_TEMPLATE.trim()));
  return {
    mode: DEFAULT_TRADEZ_EXECUTION.mode,
    notifyEntries: stored?.notifyEntries === false ? false : DEFAULT_TRADEZ_EXECUTION.notifyEntries,
    notifyExits:
      typeof stored?.notifyExits === "boolean"
        ? storedVersion >= TRADEZ_EXECUTION_PREFERENCES_VERSION
          ? stored.notifyExits
          : true
        : DEFAULT_TRADEZ_EXECUTION.notifyExits,
    template: useFreshTemplate ? DEFAULT_TRADEZ_SIGNAL_TEMPLATE : storedTemplate,
    browser: sharedChannels?.browser === false ? false : DEFAULT_ALERT_CHANNELS.browser,
    discordWebhook: String(sharedChannels?.discordWebhook || DEFAULT_ALERT_CHANNELS.discordWebhook),
    telegramToken: String(sharedChannels?.telegramToken || DEFAULT_ALERT_CHANNELS.telegramToken),
    telegramChatId: String(sharedChannels?.telegramChatId || DEFAULT_ALERT_CHANNELS.telegramChatId),
    emailTo: String(sharedChannels?.emailTo || DEFAULT_ALERT_CHANNELS.emailTo),
  };
}

function loadState() {
  const stored = readStoredJson(STORAGE_KEY, {});
  return {
    selectedToken: stored.selectedToken || DEFAULT_TOKEN,
    selectedSymbol: stored.selectedSymbol || null,
    selectedFeedSymbol: stored.selectedFeedSymbol || null,
    qualityThreshold: Number(stored.qualityThreshold) || DEFAULT_QUALITY_THRESHOLD,
    activeTab: stored.activeTab || "signals",
    workspaceMode: stored.workspaceMode === "compare" ? "compare" : "live",
    lastScanAt: Number(stored.lastScanAt) || 0,
    alertEvents: readStoredJson(ALERT_EVENTS_KEY, []).slice(0, 36),
    seenSignalIds: new Set(readStoredJson(SIGNAL_IDS_KEY, [])),
    candidates: [],
    chartAnalysis: null,
    chartSnapshot: null,
    alertPermission: typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  };
}

function persistState() {
  writeStoredJson(STORAGE_KEY, {
    selectedToken: state.selectedToken,
    selectedSymbol: state.selectedSymbol,
    selectedFeedSymbol: state.selectedFeedSymbol,
    qualityThreshold: state.qualityThreshold,
    activeTab: state.activeTab,
    workspaceMode: state.workspaceMode,
    lastScanAt: state.lastScanAt,
  });
  writeStoredJson(ALERT_EVENTS_KEY, state.alertEvents.slice(0, 36));
  writeStoredJson(SIGNAL_IDS_KEY, Array.from(state.seenSignalIds).slice(-200));
}

function persistTradezPaperState() {
  writeStoredJson(TRADEZ_AUTO_STORAGE_KEY, {
    startingBalance: tradezPaper.startingBalance,
    balance: tradezPaper.balance,
    autoEnabled: tradezPaper.autoEnabled,
    openTrades: tradezPaper.openTrades,
    closedTrades: tradezPaper.closedTrades,
    demoOrders: tradezPaper.demoOrders,
    activity: tradezPaper.activity,
    activeTab: tradezPaper.activeTab,
    lastScanAt: tradezPaper.lastScanAt,
    lastDailyBriefingUtcDate: tradezPaper.lastDailyBriefingUtcDate,
    strategyVersion: tradezPaper.strategyVersion,
  });
}

function persistTradezDeliveryState() {
  writeStoredJson(TRADEZ_EXECUTION_STORAGE_KEY, {
    preferencesVersion: TRADEZ_EXECUTION_PREFERENCES_VERSION,
    mode: tradezDelivery.mode,
    notifyEntries: tradezDelivery.notifyEntries,
    notifyExits: tradezDelivery.notifyExits,
    template: tradezDelivery.template,
  });
  writeStoredJson(ALERT_CHANNEL_STORAGE_KEY, {
    browser: tradezDelivery.browser,
    discordWebhook: tradezDelivery.discordWebhook,
    telegramToken: tradezDelivery.telegramToken,
    telegramChatId: tradezDelivery.telegramChatId,
    emailTo: tradezDelivery.emailTo,
  });
}

function readStoredJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeStoredJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Ignore storage write failures.
  }
}

function syncTradezDeliveryInputs() {
  if (dom.alertBrowserEnabled) dom.alertBrowserEnabled.checked = Boolean(tradezDelivery.browser);
  if (dom.alertDiscordWebhook) dom.alertDiscordWebhook.value = tradezDelivery.discordWebhook || "";
  if (dom.alertTelegramToken) dom.alertTelegramToken.value = tradezDelivery.telegramToken || "";
  if (dom.alertTelegramChatId) dom.alertTelegramChatId.value = tradezDelivery.telegramChatId || "";
  if (dom.alertTemplate) dom.alertTemplate.value = tradezDelivery.template || DEFAULT_TRADEZ_SIGNAL_TEMPLATE;
  if (dom.auto2NotifyEntries) dom.auto2NotifyEntries.checked = Boolean(tradezDelivery.notifyEntries);
  if (dom.auto2NotifyExits) dom.auto2NotifyExits.checked = Boolean(tradezDelivery.notifyExits);
}

function tradezModeLabel() {
  return "Binance Sync";
}

function tradeExecutionLabel() {
  return "Binance Sync";
}

function formatDemoOrderStatus(status) {
  const normalized = String(status || "PENDING").toUpperCase();
  if (normalized === "FILLED") return { label: "Filled", tone: "up" };
  if (normalized === "TP1_FILLED") return { label: "TP1 Filled", tone: "up" };
  if (normalized === "TP2_FILLED") return { label: "TP2 Filled", tone: "up" };
  if (normalized === "SL_FILLED") return { label: "SL Filled", tone: "down" };
  if (normalized === "LIVE") return { label: "Live", tone: "neutral" };
  if (normalized === "WATCHING") return { label: "Watching", tone: "neutral" };
  if (normalized === "NEW" || normalized === "PARTIALLY_FILLED") return { label: normalized.replace("_", " "), tone: "neutral" };
  if (normalized === "SUBMITTING") return { label: "Submitting", tone: "neutral" };
  if (normalized === "ERROR" || normalized === "CANCELED" || normalized === "EXPIRED" || normalized === "REJECTED") {
    return { label: normalized.replace("_", " "), tone: "down" };
  }
  return { label: normalized.replace(/_/g, " "), tone: "neutral" };
}

function trimTradezDemoOrders() {
  tradezPaper.demoOrders = tradezPaper.demoOrders.slice(0, 80);
}

function pushTradezDemoOrder(record) {
  tradezPaper.demoOrders.unshift(record);
  trimTradezDemoOrders();
}

function updateTradezDemoOrder(recordId, updater) {
  const index = tradezPaper.demoOrders.findIndex((record) => record.id === recordId);
  if (index === -1) return;
  tradezPaper.demoOrders[index] = updater({ ...tradezPaper.demoOrders[index] });
}

function findTradezDemoOrder(recordId) {
  return tradezPaper.demoOrders.find((record) => record.id === recordId) || null;
}

function isTradezDemoFinalStatus(status) {
  const normalized = String(status || "").toUpperCase();
  return ["TP2_FILLED", "SL_FILLED", "ERROR", "CANCELED", "EXPIRED", "REJECTED"].includes(normalized);
}

function describeDemoBracket(order) {
  if (!order) return "-";
  const status = formatDemoOrderStatus(order.status);
  const id = order.orderId ? `#${order.orderId}` : "pending";
  const price = Number.isFinite(order.price) ? ` @ ${formatPrice(order.price, order.pricePrecision || 2)}` : "";
  return `${id} • ${status.label}${price}`;
}

function updateTradezDeliveryNote(message) {
  if (!dom.deliveryNote) return;
  dom.deliveryNote.textContent = message;
}

function refreshTradezDeliverySummary() {
  const armed = [
    tradezDelivery.browser ? "browser" : null,
    tradezDelivery.discordWebhook ? "Discord" : null,
    tradezDelivery.telegramToken && tradezDelivery.telegramChatId ? "Telegram" : null,
    tradezDelivery.emailTo ? "email" : null,
  ].filter(Boolean);
  updateTradezDeliveryNote(
    armed.length
      ? `${tradezModeLabel()} is armed. Delivery: ${armed.join(", ")}.`
      : `${tradezModeLabel()} is armed. No remote delivery destination is saved yet.`
  );
}

function tradezRemoteChannelPayload() {
  return {
    discordWebhook: String(tradezDelivery.discordWebhook || "").trim(),
    telegramToken: String(tradezDelivery.telegramToken || "").trim(),
    telegramChatId: String(tradezDelivery.telegramChatId || "").trim(),
    emailTo: String(tradezDelivery.emailTo || "").trim(),
  };
}

function activeTradezSignalTemplate() {
  return String(tradezDelivery.template || DEFAULT_TRADEZ_SIGNAL_TEMPLATE).trim() || DEFAULT_TRADEZ_SIGNAL_TEMPLATE;
}

function binanceFuturesLink(symbol) {
  return `https://www.binance.com/en/futures/${encodeURIComponent(String(symbol || "").trim())}`;
}

function finalizeTradezSignalMessage(message, templateData) {
  let finalMessage = String(message || "").trim();
  if (!finalMessage) finalMessage = DEFAULT_TRADEZ_SIGNAL_TEMPLATE;
  const trailingLines = [];
  if (!/first detected:/i.test(finalMessage) && templateData?.firstDetectedAt) {
    trailingLines.push(`First detected: ${templateData.firstDetectedAt}`);
  }
  if (!/\b(opened|alerted):/i.test(finalMessage) && templateData?.openedAt) {
    trailingLines.push(`Opened: ${templateData.openedAt}`);
  }
  if (!/binance\.com\/en\/futures\//i.test(finalMessage) && templateData?.binanceLink) {
    trailingLines.push(`Open on Binance: ${templateData.binanceLink}`);
  }
  if (trailingLines.length) {
    finalMessage = `${finalMessage}\n${trailingLines.join("\n")}`;
  }
  return finalMessage;
}

function renderTradezSignalTemplate(templateData) {
  const rendered = activeTradezSignalTemplate().replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    const value = templateData?.[key];
    return value === undefined || value === null || value === "" ? "-" : String(value);
  });
  return finalizeTradezSignalMessage(rendered, templateData);
}

function maybeTriggerTradezBrowserNotification(title, body) {
  if (!tradezDelivery.browser || typeof Notification === "undefined" || Notification.permission !== "granted") {
    return;
  }
  const notification = new Notification(title, { body });
  window.setTimeout(() => notification.close(), 9000);
}

function dispatchTradezDelivery(event, title) {
  maybeTriggerTradezBrowserNotification(title, event.message || "");

  const destinations = tradezRemoteChannelPayload();
  if (!destinations.discordWebhook && !(destinations.telegramToken && destinations.telegramChatId) && !destinations.emailTo) {
    return;
  }

  fetch("/api/notify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      title,
      event,
      meta: {
        source: "ema_signals",
        strategy: "ema_book",
        eventType: event.deliveryType || "notification",
      },
      destinations,
    }),
  }).catch((error) => {
    console.error("tradez delivery failed", error);
  });
}

function emitServerLog(stream, event) {
  fetch("/api/log-event", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      stream,
      event,
    }),
    keepalive: true,
  }).catch(() => {
    // Database logging is observational only and must never interrupt the UI.
  });
}

function logTradezSignalOpened(candidate, trade) {
  const quoteVolume = Number(universeTickerMap.get(candidate.symbol)?.quoteVolume) || 0;
  emitServerLog("signal", {
    eventId: `${trade.id}:signal-opened`,
    source: "ema_signals",
    strategy: "ema_book",
    strategyVersion: TRADEZ_AUTO_VERSION,
    signalType: "ema_pullback_confluence",
    symbol: trade.symbol,
    token: trade.token,
    side: trade.side,
    interval: STRATEGY_INTERVAL,
    touch: trade.touch,
    strength: trade.strength,
    qualityScore: trade.qualityScore,
    detectedAt: trade.detectedAt,
    openedAt: trade.openedAt,
    eventTime: trade.openedAt,
    entryLow: trade.entryZoneLow,
    entryHigh: trade.entryZoneHigh,
    entryPrice: trade.entryPrice,
    tp1: trade.tp1,
    tp2: trade.tp2,
    stopLoss: trade.stopLoss,
    leverage: trade.leverage,
    pricePrecision: trade.pricePrecision,
    metadata: {
      note: candidate.activeSignal?.note || null,
      reasonParts: candidate.activeSignal?.reasonParts || [],
      setupBias: candidate.setupBias?.label || null,
      setupBiasTone: candidate.setupBias?.tone || null,
      rr: candidate.paperTrade?.rr || null,
      targetMarginPct: candidate.paperTrade?.targetMarginPct || null,
      stopMarginPct: candidate.paperTrade?.stopMarginPct || null,
      change24h: candidate.change24h,
      currentPrice: candidate.currentPrice,
      fundingRate: candidate.fundingRate,
      oiChange1h: candidate.oiChange1h,
      latestRsi: candidate.latestRsi,
      latestAtr: candidate.latestAtr,
      latestVolume: candidate.latestVolume,
      volumeTier: volumeTier(quoteVolume).label,
      quoteVolume,
      executionMode: trade.executionMode,
    },
  });
}

function logTradezTradeEvent(eventType, trade, extra = {}) {
  emitServerLog("trade", {
    eventId: `${trade.id}:${eventType}:${extra.eventSuffix || Number(extra.eventTime || Date.now())}`,
    tradeId: trade.id,
    source: "ema_signals",
    strategy: "ema_book",
    strategyVersion: TRADEZ_AUTO_VERSION,
    eventType,
    symbol: trade.symbol,
    side: trade.side,
    eventTime: extra.eventTime || Date.now(),
    detectedAt: trade.detectedAt,
    openedAt: trade.openedAt,
    closedAt: extra.closedAt || trade.closedAt || null,
    entryPrice: trade.entryPrice,
    exitPrice: extra.exitPrice ?? trade.exitPrice ?? null,
    tp1: trade.tp1,
    tp2: trade.tp2,
    stopLoss: trade.stopLoss,
    leverage: trade.leverage,
    quantity: trade.quantity,
    marginUsed: trade.marginUsed,
    qualityScore: trade.qualityScore,
    returnPct: extra.returnPct ?? trade.returnPct ?? null,
    pnlUsd: extra.pnlUsd ?? trade.pnlUsd ?? null,
    balanceAfter: extra.balanceAfter ?? trade.balanceAfter ?? null,
    metadata: {
      touch: trade.touch,
      strength: trade.strength,
      entryZoneLow: trade.entryZoneLow,
      entryZoneHigh: trade.entryZoneHigh,
      lastPrice: extra.lastPrice ?? trade.lastPrice ?? null,
      executionMode: trade.executionMode,
      demoStatus: trade.demoStatus || null,
      demoJournalId: trade.demoJournalId || null,
      ...extra.metadata,
    },
  });
}

async function sendTradezTestSignal() {
  saveTradezDeliveryFromForm();
  const destinations = tradezRemoteChannelPayload();
  const hasRemoteDestination =
    Boolean(destinations.discordWebhook) ||
    Boolean(destinations.emailTo) ||
    Boolean(destinations.telegramToken && destinations.telegramChatId);

  if (!tradezDelivery.browser && !hasRemoteDestination) {
    setStatus("Add a Discord webhook, Telegram bot details, email, or browser alerts before sending a test signal.", "down");
    return;
  }

  const testTime = Date.now();
  const symbol = state.selectedSymbol || `${normalizeToken(dom.tokenInput?.value || state.selectedToken)}USDT`;
  const precision = state.chartAnalysis?.pricePrecision || state.chartSnapshot?.pricePrecision || 4;
  const basePrice =
    Number(state.chartSnapshot?.ticker?.lastPrice) ||
    Number(state.chartAnalysis?.markPrice) ||
    Number(state.chartSnapshot?.ticker?.last) ||
    1;
  const sampleTrade = {
    symbol,
    side: "Long",
    entryPrice: basePrice,
    entryZoneLow: basePrice * 0.996,
    entryZoneHigh: basePrice * 1.004,
    tp1: basePrice * 1.018,
    tp2: basePrice * 1.033,
    stopLoss: basePrice * 0.99,
    leverage: TRADEZ_AUTO_LEVERAGE,
    qualityScore: Math.max(100, Number(state.chartAnalysis?.qualityScore) || 124),
    touch: state.chartAnalysis?.activeSignal?.touch || "EMA20 + S1",
    executionMode: tradezDelivery.mode,
    detectedAt: testTime,
    openedAt: testTime,
    pricePrecision: precision,
    lastPrice: basePrice,
  };
  const event = buildTradezNotificationEvent(
    "EMA Book Test Signal",
    sampleTrade,
    ["This is a delivery test from Soloris EMA Signals."],
    testTime
  );
  event.deliveryType = "test_signal";
  dispatchTradezDelivery(event, event.title);
  setStatus("Test signal sent to the currently saved delivery channels.", "up");
}

async function sendTradezDemoOrder(candidate, trade) {
  const response = await fetch("/api/binance-demo-order", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      symbol: trade.symbol,
      side: trade.side,
      quantity: trade.quantity,
      leverage: trade.leverage,
      entryPrice: trade.entryPrice,
      stopLoss: trade.stopLoss,
      tp1: trade.tp1,
      tp2: trade.tp2,
      qualityScore: trade.qualityScore,
      touch: trade.touch,
      detectedAt: trade.detectedAt,
      pricePrecision: candidate.pricePrecision,
      quantityPrecision: candidate.quantityPrecision,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Binance demo order failed.");
  }

  return payload;
}

async function fetchTradezDemoStatuses(records) {
  const response = await fetch("/api/binance-demo-status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      records: records.slice(0, DEMO_STATUS_SYNC_BATCH),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Unable to sync Binance demo statuses.");
  }

  return Array.isArray(payload.records) ? payload.records : [];
}

function paperBackupFilename() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `soloris-paper-backup-${stamp}.json`;
}

function buildPaperBackupPayload() {
  return {
    type: PAPER_BACKUP_TYPE,
    version: PAPER_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    origin: window.location.origin,
    books: {
      autoTrade: readStoredJson(HOUSE_AUTO_STORAGE_KEY, null),
      emaSignalsAuto2: readStoredJson(TRADEZ_AUTO_STORAGE_KEY, null),
    },
  };
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

function downloadTextFile(text, filename, mimeType = "text/markdown;charset=utf-8") {
  const blob = new Blob([text], { type: mimeType });
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 0);
}

function withinLast24Hours(timestamp, now = Date.now()) {
  const value = Number(timestamp);
  return Number.isFinite(value) && value > 0 && now >= value && now - value <= REPORT_LOOKBACK_MS;
}

function utcDayKey(timestamp = Date.now()) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) return new Date().toISOString().slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function utcDayStartMs(dayKey) {
  const parsed = Date.parse(`${dayKey}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function utcDayRange(dayKey) {
  const start = utcDayStartMs(dayKey);
  return {
    start,
    end: start ? start + UTC_DAY_MS : 0,
  };
}

function isWithinUtcDay(timestamp, dayKey) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return false;
  const { start, end } = utcDayRange(dayKey);
  return !!start && value >= start && value < end;
}

function formatUtcDayLabel(dayKey) {
  const start = utcDayStartMs(dayKey);
  if (!start) return dayKey;
  return new Date(start).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function tradezReportFilename(now = Date.now()) {
  const stamp = new Date(now).toISOString().replace(/:/g, "-").replace(/\..+/, "");
  return `soloris-ema-signals-24h-${stamp}.md`;
}

function tradezPaperPnlUsd(trade, exitPrice) {
  const direction = trade.side === "Short" ? -1 : 1;
  return (exitPrice - trade.entryPrice) * trade.quantity * direction;
}

function tradezEntryReason(candidate) {
  const signal = candidate.activeSignal;
  return `${signal.side} EMA pullback into ${signal.touch} (${signal.strength}) with 1H confluence, strong volume confirmation, and structured TP1/TP2 management.`;
}

function tradezKeyDetails(candidate) {
  return (candidate.activeSignal?.reasonParts || []).join(" • ");
}

function renderTradezTradeReportSection(trade, options = {}) {
  const precision = trade.pricePrecision || 2;
  const statusLabel = options.statusLabel || "Open";
  const comparisonLabel = options.comparisonLabel || "Current";
  const comparisonPrice = options.comparisonPrice;
  const returnPct =
    options.returnPct ??
    (Number.isFinite(comparisonPrice) ? tradezPaperReturnPct(trade, comparisonPrice) : Number(trade.returnPct));
  const pnlUsd =
    options.pnlUsd ??
    (Number.isFinite(comparisonPrice) ? tradezPaperPnlUsd(trade, comparisonPrice) : Number(trade.pnlUsd));
  const lines = [
    `### ${trade.symbol} • ${trade.side} • ${statusLabel}`,
    `- Timestamp: ${formatExactDateTime(trade.openedAt || trade.detectedAt)}`,
    trade.detectedAt ? `- Detected: ${formatExactDateTime(trade.detectedAt)}` : null,
    trade.openedAt ? `- Opened: ${formatExactDateTime(trade.openedAt)}` : null,
    trade.closedAt ? `- Closed: ${formatExactDateTime(trade.closedAt)}` : null,
    `- Token: ${trade.token || trade.symbol.replace(/USDT$/i, "")}`,
    `- Touch: ${trade.touch || "—"} • ${trade.strength || "Signal"}`,
    `- Entry Zone: ${formatPrice(trade.entryZoneLow, precision)} - ${formatPrice(trade.entryZoneHigh, precision)}`,
    `- Entry: ${formatPrice(trade.entryPrice, precision)}`,
    Number.isFinite(comparisonPrice)
      ? `- ${comparisonLabel}: ${formatPrice(comparisonPrice, precision)}`
      : null,
    `- TP1: ${formatPrice(trade.tp1, precision)}`,
    `- TP2: ${formatPrice(trade.tp2, precision)}`,
    `- Stop Loss: ${formatPrice(trade.stopLoss, precision)}`,
    Number.isFinite(trade.leverage) ? `- Leverage: ${trade.leverage}x` : null,
    Number.isFinite(trade.marginUsed) ? `- Margin Used: ${formatCompactUsd(trade.marginUsed, 2)}` : null,
    Number.isFinite(trade.qualityScore) ? `- Quality: Q${Math.round(trade.qualityScore)}` : null,
    Number.isFinite(trade.rr) ? `- Risk / Reward: ${trade.rr.toFixed(2)}` : null,
    Number.isFinite(returnPct) ? `- Profit/Loss: ${formatPercent(returnPct)} on margin` : null,
    Number.isFinite(pnlUsd) ? `- PnL USD: ${formatCompactUsd(pnlUsd, 2)}` : null,
    trade.reason ? `- Close Reason: ${trade.reason}` : null,
    `- Reason of entering: ${trade.entryReason || trade.signalNote || "EMA pullback setup tracked by Auto Trade 2."}`,
    `- Key details: ${trade.keyDetails || "EMA confluence, support/resistance interaction, and volume confirmation."}`,
  ];
  return lines.filter(Boolean).join("\n");
}

function buildTradez24hReport(now = Date.now()) {
  const openTrades = [...tradezPaper.openTrades];
  const closedTrades = [...tradezPaper.closedTrades];
  const demoOrders = [...tradezPaper.demoOrders];
  const openedLast24h = [...openTrades, ...closedTrades].filter((trade) =>
    withinLast24Hours(trade.openedAt || trade.detectedAt, now)
  );
  const closedLast24h = closedTrades.filter((trade) => withinLast24Hours(trade.closedAt, now));
  const activityLast24h = tradezPaper.activity.filter((event) => withinLast24Hours(event.time, now));
  const demoLast24h = demoOrders.filter((order) =>
    withinLast24Hours(order.createdAt || order.detectedAt || order.lastUpdatedAt, now)
  );
  const unrealizedUsd = openTrades.reduce((sum, trade) => {
    if (!Number.isFinite(trade.lastPrice)) return sum;
    return sum + tradezPaperPnlUsd(trade, trade.lastPrice);
  }, 0);
  const currentEquity = tradezPaper.balance + unrealizedUsd;
  const tpCount = closedLast24h.filter((trade) => trade.reason === "TP").length;
  const slCount = closedLast24h.filter((trade) => trade.reason === "SL").length;
  const beCount = closedLast24h.filter((trade) => trade.reason === "BE").length;
  const report = [
    "# Soloris Signals — EMA Signals 24H Review",
    "",
    `Exported at: ${formatExactDateTime(now)}`,
    `Window: last 24 hours ending ${formatExactDateTime(now)}`,
    "",
    "## Summary",
    `- Opening balance: ${formatPrice(tradezPaper.startingBalance, 2)}`,
    `- Current balance: ${formatPrice(tradezPaper.balance, 2)}`,
    `- Current equity: ${formatPrice(currentEquity, 2)}`,
    `- Realized PnL: ${formatCompactUsd(tradezPaper.balance - tradezPaper.startingBalance, 2)}`,
    `- Unrealized PnL: ${formatCompactUsd(unrealizedUsd, 2)}`,
    `- Open EMA positions now: ${openTrades.length}`,
    `- Trades opened in last 24H: ${openedLast24h.length}`,
    `- Trades closed in last 24H: ${closedLast24h.length}`,
    `- TP hits in last 24H: ${tpCount}`,
    `- SL hits in last 24H: ${slCount}`,
    `- Breakeven exits in last 24H: ${beCount}`,
    `- Demo orders touched in last 24H: ${demoLast24h.length}`,
    `- Last EMA scan: ${tradezPaper.lastScanAt ? formatExactDateTime(tradezPaper.lastScanAt) : "—"}`,
    "",
    "## Trades Opened In Last 24 Hours",
    openedLast24h.length
      ? openedLast24h
          .sort((left, right) => (right.openedAt || right.detectedAt || 0) - (left.openedAt || left.detectedAt || 0))
          .map((trade) =>
            renderTradezTradeReportSection(trade, {
              statusLabel: closedTrades.includes(trade) ? "Closed" : "Open",
              comparisonLabel: closedTrades.includes(trade) ? "Exit" : "Current",
              comparisonPrice: closedTrades.includes(trade) ? trade.exitPrice : trade.lastPrice,
            })
          )
          .join("\n\n")
      : "_No EMA Book trades opened in the last 24 hours._",
    "",
    "## Trades Closed In Last 24 Hours",
    closedLast24h.length
      ? closedLast24h
          .sort((left, right) => (right.closedAt || 0) - (left.closedAt || 0))
          .map((trade) =>
            renderTradezTradeReportSection(trade, {
              statusLabel: "Closed",
              comparisonLabel: "Exit",
              comparisonPrice: trade.exitPrice,
              returnPct: trade.returnPct,
              pnlUsd: trade.pnlUsd,
            })
          )
          .join("\n\n")
      : "_No EMA Book trades closed in the last 24 hours._",
    "",
    "## Current Open Positions Snapshot",
    openTrades.length
      ? openTrades
          .sort((left, right) => (right.openedAt || 0) - (left.openedAt || 0))
          .map((trade) =>
            renderTradezTradeReportSection(trade, {
              statusLabel: "Open",
              comparisonLabel: "Current",
              comparisonPrice: trade.lastPrice,
            })
          )
          .join("\n\n")
      : "_No live EMA Book positions._",
    "",
    "## Demo Orders (24H)",
    demoLast24h.length
      ? demoLast24h
          .sort((left, right) => (right.createdAt || right.detectedAt || 0) - (left.createdAt || left.detectedAt || 0))
          .map((order) => {
            const precision = order.pricePrecision || 2;
            return [
              `### ${order.symbol} • ${order.side || "—"} • ${order.status || "UNKNOWN"}`,
              `- Timestamp: ${formatExactDateTime(order.createdAt || order.detectedAt)}`,
              `- Entry: ${Number.isFinite(order.entryPrice) ? formatPrice(order.entryPrice, precision) : "—"}`,
              `- TP1: ${Number.isFinite(order.tp1) ? formatPrice(order.tp1, precision) : "—"}`,
              `- TP2: ${Number.isFinite(order.tp2) ? formatPrice(order.tp2, precision) : "—"}`,
              `- Stop Loss: ${Number.isFinite(order.stopLoss) ? formatPrice(order.stopLoss, precision) : "—"}`,
              `- Leverage: ${Number.isFinite(order.leverage) ? `${order.leverage}x` : "—"}`,
              `- Quality: ${Number.isFinite(order.qualityScore) ? `Q${Math.round(order.qualityScore)}` : "—"}`,
              order.error ? `- Error: ${order.error}` : null,
              Array.isArray(order.warnings) && order.warnings.length
                ? `- Warnings: ${order.warnings.join(" • ")}`
                : null,
            ]
              .filter(Boolean)
              .join("\n");
          })
          .join("\n\n")
      : "_No demo order activity in the last 24 hours._",
    "",
    "## EMA Activity Feed (24H)",
    activityLast24h.length
      ? activityLast24h
          .sort((left, right) => (right.time || 0) - (left.time || 0))
          .map((event) => `- ${formatExactDateTime(event.time)} • ${event.message}`)
          .join("\n")
      : "_No EMA activity events in the last 24 hours._",
    "",
  ];

  return report.join("\n");
}

function normalizeImportedHouseBook(rawBook) {
  if (!rawBook || typeof rawBook !== "object") return null;
  return {
    ...rawBook,
    strategyVersion: HOUSE_AUTO_STRATEGY_VERSION,
  };
}

function normalizeImportedTradezBook(rawBook) {
  if (!rawBook || typeof rawBook !== "object") return null;
  const book = {
    ...rawBook,
    startingBalance: Number(rawBook.startingBalance) || TRADEZ_AUTO_START_BALANCE,
    balance:
      Number(rawBook.balance) ||
      Number(rawBook.startingBalance) ||
      TRADEZ_AUTO_START_BALANCE,
    lastDailyBriefingUtcDate: rawBook.lastDailyBriefingUtcDate || utcDayKey(Date.now() - UTC_DAY_MS),
    strategyVersion: TRADEZ_AUTO_VERSION,
  };
  normalizeTradezResearchBook(book);
  return book;
}

async function importPaperBackup(file) {
  if (!file) return;
  let parsed;

  try {
    parsed = JSON.parse(await file.text());
  } catch (error) {
    throw new Error("Backup file could not be read. Please choose a valid JSON export.");
  }

  if (!parsed || parsed.type !== PAPER_BACKUP_TYPE || !parsed.books) {
    throw new Error("This file is not a valid Soloris paper-trade backup.");
  }

  const restoredBooks = [];
  const houseBook = normalizeImportedHouseBook(parsed.books.autoTrade);
  const emaBook = normalizeImportedTradezBook(parsed.books.emaSignalsAuto2);

  if (houseBook) {
    writeStoredJson(HOUSE_AUTO_STORAGE_KEY, houseBook);
    restoredBooks.push("Auto Trade");
  }

  if (emaBook) {
    writeStoredJson(TRADEZ_AUTO_STORAGE_KEY, emaBook);
    restoredBooks.push("Auto Trade 2");
  }

  if (!restoredBooks.length) {
    throw new Error("The backup file did not contain any paper-trade books to restore.");
  }

  Object.assign(tradezPaper, loadTradezPaperState());
  persistTradezPaperState();
  renderTradezPaperDashboard();
  renderTradezComparison();
  setStatus(`Backup restored for ${restoredBooks.join(" and ")}.`, "up");
}

function formatCompactUsd(value, digits = 2) {
  if (!Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : "-"}$${new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: digits,
  }).format(Math.abs(value))}`;
}

function getFallbackExchangeInfo() {
  const fallback = window.APEX_FALLBACK_PERPS;
  if (!fallback || !Array.isArray(fallback.symbols) || !fallback.symbols.length) return null;
  return fallback;
}

function setStatus(message, tone = "neutral") {
  dom.statusBanner.textContent = message;
  dom.statusBanner.className = `status-banner ${tone}`;
}

function applyRemoteRuntimeState(remoteState) {
  if (!remoteState || typeof remoteState !== "object") return;
  const localTradezTab = tradezPaper.activeTab;
  remoteRuntimeHydrating = true;
  state.qualityThreshold = Math.max(50, Number(remoteState.qualityThreshold) || DEFAULT_QUALITY_THRESHOLD);
  state.lastScanAt = Number(remoteState.lastScanAt) || 0;
  state.candidates = Array.isArray(remoteState.lastCandidates) ? remoteState.lastCandidates : [];
  tradezPaper.startingBalance = Number(remoteState.startingBalance) || TRADEZ_AUTO_START_BALANCE;
  tradezPaper.balance =
    Number(remoteState.balance) || Number(remoteState.startingBalance) || TRADEZ_AUTO_START_BALANCE;
  tradezPaper.autoEnabled = remoteState.autoEnabled !== false;
  tradezPaper.openTrades = Array.isArray(remoteState.openTrades) ? remoteState.openTrades : [];
  tradezPaper.closedTrades = Array.isArray(remoteState.closedTrades) ? remoteState.closedTrades : [];
  tradezPaper.demoOrders = Array.isArray(remoteState.demoOrders) ? remoteState.demoOrders : [];
  tradezPaper.activity = Array.isArray(remoteState.activity) ? remoteState.activity : [];
  tradezPaper.activeTab = localTradezTab || remoteState.activeTab || "positions";
  tradezPaper.lastScanAt = Number(remoteState.lastScanAt) || 0;
  tradezPaper.lastDailyBriefingUtcDate =
    remoteState.lastDailyBriefingUtcDate || utcDayKey(Date.now() - UTC_DAY_MS);
  tradezPaper.strategyVersion = Number(remoteState.strategyVersion) || TRADEZ_AUTO_VERSION;
  dom.qualityThreshold.value = `${state.qualityThreshold}`;
  candidateMap = new Map(state.candidates.map((candidate) => [candidate.symbol, candidate]));
  latestBatchMap = new Map(candidateMap);
  persistState();
  persistTradezPaperState();
  remoteRuntimeHydrating = false;
}

async function fetchRemoteRuntimeState() {
  const response = await fetch("/api/tradez-runtime", {
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Tradez runtime failed (${response.status})`);
  }
  return payload;
}

async function postRemoteRuntimeAction(action, settings = {}) {
  const response = await fetch("/api/tradez-runtime", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      action,
      settings,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Tradez runtime update failed (${response.status})`);
  }
  return payload;
}

async function refreshRemoteDisplayData() {
  try {
    const universe = await getPerpUniverse();
    if (!universe?.length) return;
    const tickers = await fetchUniverseTickers();
    universeTickerMap = buildTickerLookup(tickers);
  } catch (error) {
    // Display refresh is best-effort only.
  }
}

function renderTradezRuntimeState() {
  state.candidates.forEach(pushAlertEvent);
  renderSignalFeed();
  renderAlertFeed();
  updateMetrics();
  renderTradezPaperDashboard();
}

function stopRemoteRuntimePolling() {
  if (remoteRuntimePollTimer) window.clearInterval(remoteRuntimePollTimer);
  if (remoteDisplayRefreshTimer) window.clearInterval(remoteDisplayRefreshTimer);
  remoteRuntimePollTimer = null;
  remoteDisplayRefreshTimer = null;
}

async function pullRemoteRuntimeState() {
  const payload = await fetchRemoteRuntimeState();
  remoteRuntimeEnabled = Boolean(payload.backgroundAvailable);
  if (!remoteRuntimeEnabled) return payload;
  applyRemoteRuntimeState(payload.state || {});
  renderTradezRuntimeState();
  if (payload.state?.lastStatusMessage) {
    setStatus(payload.state.lastStatusMessage, payload.state.lastStatusTone || "neutral");
  }
  return payload;
}

function startRemoteRuntimePolling() {
  stopRemoteRuntimePolling();
  remoteRuntimePollTimer = window.setInterval(() => {
    pullRemoteRuntimeState().catch(() => {
      // Keep last-known remote state visible if a sync poll fails.
    });
  }, REMOTE_RUNTIME_POLL_MS);
  remoteDisplayRefreshTimer = window.setInterval(() => {
    refreshRemoteDisplayData().then(() => {
      renderTradezRuntimeState();
    }).catch(() => {
      // Best effort only.
    });
  }, REMOTE_DISPLAY_REFRESH_MS);
}

function setStreamStatus(message, tone = "neutral") {
  dom.streamStatus.textContent = message;
  dom.streamStatus.className = `stream-status ${tone}`;
}

function normalizeToken(rawToken) {
  const cleaned = String(rawToken || "")
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]/g, "");

  if (!cleaned) return DEFAULT_TOKEN;
  if (cleaned.endsWith(QUOTE_ASSET)) return cleaned.slice(0, -QUOTE_ASSET.length) || DEFAULT_TOKEN;
  return cleaned;
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function scoreSymbolCandidate(symbolInfo, cleanedToken) {
  const inputWithQuote = `${cleanedToken}${QUOTE_ASSET}`;
  let score = 0;

  if (symbolInfo.symbol === cleanedToken) score += 120;
  if (symbolInfo.symbol === inputWithQuote) score += 110;
  if (symbolInfo.baseAsset === cleanedToken) score += 95;
  if (symbolInfo.baseAsset.endsWith(cleanedToken)) score += 65;
  if (symbolInfo.baseAsset.startsWith(cleanedToken)) score += 55;
  if (symbolInfo.symbol.includes(cleanedToken)) score += 25;

  score -= Math.abs(symbolInfo.baseAsset.length - cleanedToken.length);
  return score;
}

function perpUniverseSymbols(exchangeInfo) {
  return (exchangeInfo.symbols || []).filter(
    (symbolInfo) =>
      symbolInfo.quoteAsset === QUOTE_ASSET &&
      symbolInfo.contractType === "PERPETUAL" &&
      symbolInfo.status === "TRADING"
  );
}

function resolvePerpSymbol(rawToken, exchangeInfo) {
  const cleanedToken = normalizeToken(rawToken);
  const ranked = perpUniverseSymbols(exchangeInfo)
    .map((symbolInfo) => ({
      symbolInfo,
      score: scoreSymbolCandidate(symbolInfo, cleanedToken),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.symbolInfo.symbol.length - right.symbolInfo.symbol.length;
    });

  const resolved = ranked[0]?.symbolInfo || null;
  if (!resolved) throw new Error(`No USDT perpetual contract found for "${cleanedToken}".`);

  return {
    cleanedToken,
    symbol: resolved.symbol,
    baseAsset: resolved.baseAsset,
    pricePrecision: resolved.pricePrecision,
  };
}

function volumeTier(quoteVolume) {
  if (quoteVolume >= 750_000_000) return { label: "High Volume", tone: "up" };
  if (quoteVolume >= 100_000_000) return { label: "Mid Cap Volume", tone: "neutral" };
  return { label: "Low Cap Volume", tone: "down" };
}

function hasGoodTradingVolume(quoteVolume) {
  return Number(quoteVolume) >= 50_000_000;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index];
}

function pctChange(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === 0) return 0;
  return ((end - start) / Math.abs(start)) * 100;
}

function pctChangeFromLookback(values, lookback) {
  if (values.length <= lookback) return 0;
  return pctChange(values[values.length - 1 - lookback], values[values.length - 1]);
}

function slopePercentage(values, lookback = 10) {
  const filtered = values.filter((value) => value != null);
  if (filtered.length <= lookback) return 0;
  return pctChange(filtered[filtered.length - 1 - lookback], filtered[filtered.length - 1]);
}

function latestDefinedValue(values) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] != null) return values[index];
  }
  return null;
}

function priceDigits(value, precisionHint = 2) {
  if (!Number.isFinite(value)) return Math.min(Math.max(precisionHint, 2), 8);
  if (value >= 1000) return 2;
  if (value >= 1) return Math.min(Math.max(precisionHint, 2), 4);
  return Math.min(Math.max(precisionHint, 4), 8);
}

function formatPrice(value, precisionHint = 2) {
  if (!Number.isFinite(value)) return "-";
  return `$${Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: priceDigits(value, precisionHint),
  })}`;
}

function formatPercent(value, digits = 2) {
  if (!Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatCompactNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: digits,
  }).format(value);
}

function formatClock(timestamp) {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTime(timestamp) {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatExactDateTime(timestamp) {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function buildTradezNotificationEvent(title, trade, extraLines = [], time = Date.now()) {
  const precision = trade.pricePrecision || 2;
  const entryZone =
    Number.isFinite(trade.entryZoneLow) && Number.isFinite(trade.entryZoneHigh)
      ? `${formatPrice(Math.min(trade.entryZoneLow, trade.entryZoneHigh), precision)} - ${formatPrice(
          Math.max(trade.entryZoneLow, trade.entryZoneHigh),
          precision
        )}`
      : formatPrice(trade.entryPrice, precision);
  const firstDetectedAt = formatExactDateTime(trade.detectedAt || trade.openedAt || time);
  const openedAt = formatExactDateTime(time);
  const binanceLink = binanceFuturesLink(trade.symbol);
  const baseLines = [
    `Mode: ${tradeExecutionLabel(trade.executionMode)}`,
    `Side: ${trade.side}`,
    `Entry: ${formatPrice(trade.entryPrice, precision)}`,
    `Entry Zone: ${entryZone}`,
    `TP1: ${formatPrice(trade.tp1, precision)}`,
    `TP2: ${formatPrice(trade.tp2, precision)}`,
    `SL: ${formatPrice(trade.stopLoss, precision)}`,
    `Leverage: ${trade.leverage}x`,
    `Quality: Q${Math.round(trade.qualityScore || 0)}`,
    `First detected: ${firstDetectedAt}`,
    `Opened: ${openedAt}`,
    `Open on Binance: ${binanceLink}`,
  ];
  const templateData = {
    title,
    symbol: trade.symbol,
    side: trade.side,
    entry: formatPrice(trade.entryPrice, precision),
    entryZone,
    tp1: formatPrice(trade.tp1, precision),
    tp2: formatPrice(trade.tp2, precision),
    sl: formatPrice(trade.stopLoss, precision),
    leverage: `${trade.leverage}`,
    quality: `${Math.round(trade.qualityScore || 0)}`,
    touch: trade.touch || "-",
    detectedAt: firstDetectedAt,
    firstDetectedAt,
    alertedAt: openedAt,
    openedAt,
    mode: tradeExecutionLabel(trade.executionMode),
    price: formatPrice(trade.lastPrice || trade.entryPrice, precision),
    binanceLink,
    notes: extraLines.filter(Boolean).join(" • "),
  };

  return {
    time,
    symbol: trade.symbol,
    message: [...baseLines, ...extraLines].filter(Boolean).join("\n"),
    title,
    formattedMessage: renderTradezSignalTemplate(templateData),
  };
}

function maybeSendTradezEntryNotification(candidate, trade) {
  if (!tradezDelivery.notifyEntries) return;
  const touchLabel = [candidate.activeSignal?.touch, candidate.activeSignal?.strength].filter(Boolean).join(" • ");
  const event = buildTradezNotificationEvent(
    `EMA Book ${trade.side} ${trade.symbol}`,
    trade,
    [
      touchLabel ? `Setup: ${touchLabel}` : "",
      `Status: Trade opened after the entry zone retest confirmed.`,
    ],
    trade.openedAt
  );
  event.deliveryType = "entry_opened";
  dispatchTradezDelivery(event, event.title);
}

function maybeSendTradezProgressNotification(kind, trade, extraLines = [], time = Date.now()) {
  if (!tradezDelivery.notifyExits) return;
  const titleMap = {
    tp1: `EMA Book TP1 ${trade.symbol}`,
    tp: `EMA Book TP ${trade.symbol}`,
    sl: `EMA Book SL ${trade.symbol}`,
    be: `EMA Book BE ${trade.symbol}`,
  };
  const precision = trade.pricePrecision || 2;
  const baseLine = `${trade.symbol} • ${trade.side} • ${trade.leverage || TRADEZ_AUTO_LEVERAGE}x`;
  const detectedLine = `At ${formatExactDateTime(time)}`;
  const shortMessageMap = {
    tp1: [
      "SUCCESS.. TP1 Hit✅",
      baseLine,
      `Entry ${formatPrice(trade.entryPrice, precision)} • TP1 ${formatPrice(trade.tp1, precision)}`,
      `SL moved to entry ${formatPrice(trade.entryPrice, precision)}`,
      detectedLine,
      `Open on Binance: ${binanceFuturesLink(trade.symbol)}`,
    ],
    tp: [
      "SUCCESS.. TP2 Hit✅",
      baseLine,
      `Entry ${formatPrice(trade.entryPrice, precision)} • TP2 ${formatPrice(trade.tp2, precision)}`,
      `Exit ${formatPrice(trade.exitPrice || trade.tp2, precision)}`,
      detectedLine,
      `Open on Binance: ${binanceFuturesLink(trade.symbol)}`,
    ],
    sl: [
      "Oh No, SL HIT❌",
      baseLine,
      `Entry ${formatPrice(trade.entryPrice, precision)} • SL ${formatPrice(trade.stopLoss, precision)}`,
      `Exit ${formatPrice(trade.exitPrice || trade.stopLoss, precision)}`,
      detectedLine,
      `Open on Binance: ${binanceFuturesLink(trade.symbol)}`,
    ],
    be: [
      "Protected at Entry🛡️",
      baseLine,
      `Breakeven exit ${formatPrice(trade.exitPrice || trade.entryPrice, precision)}`,
      detectedLine,
      `Open on Binance: ${binanceFuturesLink(trade.symbol)}`,
    ],
  };
  const shortLines = shortMessageMap[kind] || [
    titleMap[kind] || `EMA Book Update ${trade.symbol}`,
    baseLine,
    detectedLine,
  ];
  const event = {
    ...buildTradezNotificationEvent(titleMap[kind] || `EMA Book Update ${trade.symbol}`, trade, extraLines, time),
    message: [...shortLines, ...extraLines.filter(Boolean)].join("\n"),
    formattedMessage: [...shortLines, ...extraLines.filter(Boolean)].join("\n"),
    deliveryType:
      kind === "tp1"
        ? "tp1_hit"
        : kind === "tp"
          ? "tp_hit"
          : kind === "sl"
            ? "sl_hit"
            : "break_even_exit",
  };
  dispatchTradezDelivery(event, event.title);
}

function buildTradezDailyBriefing(dayKey) {
  const openedTrades = tradezPaper.closedTrades
    .concat(tradezPaper.openTrades)
    .filter((trade) => isWithinUtcDay(trade.openedAt || trade.detectedAt, dayKey));
  const closedTrades = tradezPaper.closedTrades.filter((trade) => isWithinUtcDay(trade.closedAt, dayKey));
  const winners = closedTrades.filter((trade) => trade.reason === "TP");
  const stopLosses = closedTrades.filter((trade) => trade.reason === "SL");
  const breakevens = closedTrades.filter((trade) => trade.reason === "BE");
  const avgGainPct = average(winners.map((trade) => Number(trade.returnPct)).filter(Number.isFinite));
  const avgLossPct = average(
    stopLosses.map((trade) => Math.abs(Number(trade.returnPct))).filter(Number.isFinite)
  );
  const realizedUsd = closedTrades.reduce((sum, trade) => sum + (Number(trade.pnlUsd) || 0), 0);
  const realizedPct = pctChange(tradezPaper.startingBalance, tradezPaper.startingBalance + realizedUsd);

  return {
    dayKey,
    label: formatUtcDayLabel(dayKey),
    tradesTaken: openedTrades.length,
    profitsHit: winners.length,
    avgGainPct: Number.isFinite(avgGainPct) ? avgGainPct : 0,
    slsHit: stopLosses.length,
    avgLossPct: Number.isFinite(avgLossPct) ? avgLossPct : 0,
    breakevens: breakevens.length,
    realizedUsd,
    realizedPct,
    openRunners: tradezPaper.openTrades.length,
  };
}

function maybeSendTradezDailyBriefing(now = Date.now()) {
  const previousDayKey = utcDayKey(now - UTC_DAY_MS);
  if (tradezPaper.lastDailyBriefingUtcDate === previousDayKey) return;

  const briefing = buildTradezDailyBriefing(previousDayKey);
  const lines = [
    "📘 EMA BOOK DAILY BRIEFING",
    `Date (UTC): ${briefing.label}`,
    `Trades taken: ${briefing.tradesTaken}`,
    `Profits hit: ${briefing.profitsHit}`,
    `Avg gain: ${briefing.profitsHit ? formatPercent(briefing.avgGainPct) : "0.00%"}`,
    `SLs hit: ${briefing.slsHit}`,
    `Avg loss: ${briefing.slsHit ? `-${Math.abs(briefing.avgLossPct).toFixed(2)}%` : "0.00%"}`,
    `Breakeven exits: ${briefing.breakevens}`,
    `Overall realized PnL: ${formatCompactUsd(briefing.realizedUsd, 2)}`,
    `Overall realized return: ${formatPercent(briefing.realizedPct)}`,
    `Open runners carried: ${briefing.openRunners}`,
  ];

  dispatchTradezDelivery(
    {
      time: now,
      symbol: "EMA_BOOK",
      title: "EMA Book Daily Briefing",
      deliveryType: "daily_briefing",
      message: lines.join("\n"),
      formattedMessage: lines.join("\n"),
    },
    "EMA Book Daily Briefing"
  );

  tradezPaper.lastDailyBriefingUtcDate = previousDayKey;
  logTradezPaperActivity(
    `Daily EMA briefing sent for ${briefing.label} • ${briefing.tradesTaken} trades • ${formatCompactUsd(
      briefing.realizedUsd,
      2
    )} realized.`,
    briefing.realizedUsd >= 0 ? "up" : "down"
  );
  persistTradezPaperState();
}

function markTradezDemoTp1(trade, candidate, statusRecord) {
  if (trade.tp1Hit) return;
  trade.tp1Hit = true;
  trade.currentTarget = trade.tp2;
  trade.demoTp1Notified = true;
  const markPrice =
    Number(statusRecord?.position?.markPrice) ||
    Number(statusRecord?.tp1Order?.avgPrice) ||
    Number(statusRecord?.tp1Order?.price) ||
    trade.tp1;
  trade.lastPrice = markPrice;
  logTradezPaperActivity(
    `${trade.symbol} hit TP1 on Binance Demo. The runner stays open while TP2 remains the next objective.`,
    trade.side === "Long" ? "up" : "down"
  );
  logTradezTradeEvent("tp1_hit", trade, {
    eventSuffix: "tp1",
    eventTime: Number(statusRecord?.tp1Order?.updateTime) || Date.now(),
    metadata: {
      exitType: "tp1",
      demoSync: true,
      markPrice,
      runnerTarget: trade.tp2,
    },
  });
  maybeSendTradezProgressNotification(
    "tp1",
    trade,
    [
      `TP1 hit: ${formatPrice(trade.tp1, candidate?.pricePrecision || trade.pricePrecision)}`,
      `Demo mark: ${formatPrice(markPrice, candidate?.pricePrecision || trade.pricePrecision)}`,
      `Runner target: ${formatPrice(trade.tp2, candidate?.pricePrecision || trade.pricePrecision)}`,
    ],
    Number(statusRecord?.tp1Order?.updateTime) || Date.now()
  );
}

function closeTradezDemoSyncedTrade(trade, reason, exitPrice, precisionHint, extraLines = [], time = Date.now()) {
  const closedTrade = closeTradezPaperTrade(
    trade.id,
    reason,
    exitPrice,
    precisionHint || trade.pricePrecision || 2
  );
  if (!closedTrade) return null;
  const kind = reason === "TP" ? "tp" : reason === "BE" ? "be" : "sl";
  maybeSendTradezProgressNotification(kind, closedTrade, extraLines, time);
  return closedTrade;
}

async function syncTradezDemoStatuses(candidates) {
  const demoTrades = tradezPaper.openTrades.filter(
    (trade) => trade.executionMode === "demo" && trade.demoJournalId
  );
  if (!demoTrades.length && !tradezPaper.demoOrders.some((record) => !isTradezDemoFinalStatus(record.status))) {
    return;
  }

  const candidateLookup = new Map(candidates.map((candidate) => [candidate.symbol, candidate]));
  const recordsToSync = [];

  demoTrades.forEach((trade) => {
    const record = findTradezDemoOrder(trade.demoJournalId);
    if (!record) return;
    recordsToSync.push({
      id: record.id,
      symbol: trade.symbol,
      entryOrderId: record.entryOrder?.orderId || trade.demoOrderId || null,
      tp1OrderId: record.tp1Order?.orderId || null,
      tp2OrderId: record.tp2Order?.orderId || null,
      stopOrderId: record.stopOrder?.orderId || null,
    });
  });

  if (!recordsToSync.length) return;

  let statusRecords;
  try {
    statusRecords = await fetchTradezDemoStatuses(recordsToSync);
  } catch (error) {
    logTradezPaperActivity(`Binance demo sync failed • ${error.message}`, "down");
    return;
  }

  statusRecords.forEach((statusRecord) => {
    updateTradezDemoOrder(statusRecord.id, (record) => ({
      ...record,
      checkedAt: statusRecord.checkedAt || Date.now(),
      status: statusRecord.overallStatus || record.status,
      entryOrder: statusRecord.entryOrder || record.entryOrder,
      tp1Order: statusRecord.tp1Order || record.tp1Order,
      tp2Order: statusRecord.tp2Order || record.tp2Order,
      stopOrder: statusRecord.stopOrder || record.stopOrder,
      position: statusRecord.position || record.position,
      warnings: Array.isArray(statusRecord.warnings) ? statusRecord.warnings : record.warnings || [],
      error: "",
    }));

    const trade = tradezPaper.openTrades.find((item) => item.demoJournalId === statusRecord.id);
    if (!trade) return;

    const candidate = candidateLookup.get(trade.symbol);
    const precision = candidate?.pricePrecision || trade.pricePrecision || 2;
    const markPrice =
      Number(statusRecord.position?.markPrice) ||
      candidate?.currentPrice ||
      trade.lastPrice ||
      trade.entryPrice;

    trade.lastPrice = markPrice;
    trade.pricePrecision = precision;
    trade.demoStatus = statusRecord.overallStatus || trade.demoStatus || "WATCHING";

    if (
      String(statusRecord.tp1Order?.status || "").toUpperCase() === "FILLED" &&
      !trade.tp1Hit
    ) {
      markTradezDemoTp1(trade, candidate, statusRecord);
    }

    if (String(statusRecord.tp2Order?.status || "").toUpperCase() === "FILLED") {
      closeTradezDemoSyncedTrade(
        trade,
        "TP",
        Number(statusRecord.tp2Order?.avgPrice) ||
          Number(statusRecord.tp2Order?.price) ||
          trade.tp2,
        precision,
        [
          `Exchange status: TP2 filled`,
          `Exit: ${formatPrice(Number(statusRecord.tp2Order?.avgPrice) || Number(statusRecord.tp2Order?.price) || trade.tp2, precision)}`,
        ],
        Number(statusRecord.tp2Order?.updateTime) || Date.now()
      );
      updateTradezDemoOrder(statusRecord.id, (record) => ({
        ...record,
        status: "TP2_FILLED",
      }));
      return;
    }

    if (String(statusRecord.stopOrder?.status || "").toUpperCase() === "FILLED") {
      const stopExit =
        Number(statusRecord.stopOrder?.avgPrice) ||
        Number(statusRecord.stopOrder?.stopPrice) ||
        Number(statusRecord.stopOrder?.price) ||
        trade.stopLoss;
      const closeReason =
        Math.abs((stopExit - trade.entryPrice) / Math.max(Math.abs(trade.entryPrice), 0.0000001)) <
        0.0005
          ? "BE"
          : "SL";
      closeTradezDemoSyncedTrade(
        trade,
        closeReason,
        stopExit,
        precision,
        [
          `Exchange status: ${closeReason === "BE" ? "breakeven stop" : "stop filled"}`,
          `Exit: ${formatPrice(stopExit, precision)}`,
        ],
        Number(statusRecord.stopOrder?.updateTime) || Date.now()
      );
      updateTradezDemoOrder(statusRecord.id, (record) => ({
        ...record,
        status: "SL_FILLED",
      }));
    }
  });
}

function isFreshSignal(timestamp) {
  if (!timestamp) return false;
  return Date.now() - timestamp <= FRESH_SIGNAL_WINDOW_MS;
}

function toneFromNumber(value, flatBand = 0.02) {
  if (!Number.isFinite(value)) return "neutral";
  if (value > flatBand) return "up";
  if (value < -flatBand) return "down";
  return "neutral";
}

function qualityTier(score) {
  if (!Number.isFinite(score)) return { className: "quality-tier-neutral", label: "Unscored" };
  if (score >= 200) return { className: "quality-tier-shining-gold", label: "Elite" };
  if (score >= 100) return { className: "quality-tier-gold", label: "Prime" };
  if (score >= 80) return { className: "quality-tier-green", label: "Strong" };
  if (score >= 60) return { className: "quality-tier-light-orange", label: "Watch" };
  if (score >= 40) return { className: "quality-tier-orange", label: "Weak" };
  return { className: "quality-tier-red", label: "Poor" };
}

function setQualityMeter(score) {
  if (!dom.qualityMeter || !dom.qualityLabel) return;
  const progress = Math.max(6, Math.min(100, Math.round((Math.max(0, score) / 200) * 100)));
  dom.qualityMeter.style.setProperty("--quality-progress", `${progress}%`);
  dom.qualityLabel.textContent = score > 0 ? qualityTier(score).label : "Monitoring";
}

function createPill(text, tone) {
  const pill = document.createElement("span");
  pill.className = `pill ${tone}`;
  pill.textContent = text;
  return pill;
}

function renderLevelBands(container, levels, bandWidth, tone, precisionHint) {
  container.innerHTML = "";
  if (!levels.length) {
    container.appendChild(createPill("No clear level", "neutral"));
    return;
  }

  levels.forEach((level) => {
    const low = level - bandWidth;
    const high = level + bandWidth;
    container.appendChild(
      createPill(`${formatPrice(low, precisionHint)} - ${formatPrice(high, precisionHint)}`, tone)
    );
  });
}

function renderSignalList(items) {
  dom.signalList.innerHTML = "";
  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "signal-item";
    card.innerHTML = `
      <span>${item.label}</span>
      <strong class="${item.tone || "neutral"}">${item.value}</strong>
      <small>${item.note}</small>
    `;
    dom.signalList.appendChild(card);
  });
}

function renderAnalysisGrid(container, items) {
  container.innerHTML = "";
  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "analysis-card";
    const badgeMarkup = item.badge
      ? `<em class="analysis-card-badge ${item.badgeClass || ""}">${item.badge}</em>`
      : "";
    card.innerHTML = `
      <div class="analysis-card-topline">
        <span>${item.label}</span>
        ${badgeMarkup}
      </div>
      <strong class="${item.tone || "neutral"}">${item.value}</strong>
      <small>${item.note}</small>
    `;
    container.appendChild(card);
  });
}

function renderTable(container, rows, emptyText) {
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = `
      <div class="table-row">
        <div>
          <span>Status</span>
          <strong>${emptyText}</strong>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = rows
    .map(
      (row) => `
        <div class="table-row">
          <div>
            <span>${row.label}</span>
            <strong class="${row.tone || "neutral"}">${row.primary}</strong>
          </div>
          <div>
            <span>${row.secondaryLabel}</span>
            <strong>${row.secondary}</strong>
          </div>
          <div>
            <span>${row.tertiaryLabel}</span>
            <strong>${row.tertiary}</strong>
          </div>
        </div>
      `
    )
    .join("");
}

function renderCompareCards(cards) {
  if (!dom.compareGrid) return;
  dom.compareGrid.innerHTML = cards
    .map(
      (card) => `
        <article class="subpanel tradez-compare-card ${card.tone || "neutral"} ${card.isOverallLeader ? "is-overall-leader" : ""}">
          <div class="panel-head-inline">
            <div>
              <p class="panel-label">${card.label}</p>
              <h3>${card.title}</h3>
            </div>
            <div class="tradez-compare-chip-stack">
              ${card.isOverallLeader ? `<span class="tradez-compare-overall-ribbon">Overall Leader</span>` : ""}
              <div class="quality-chip ${card.qualityClass || "quality-tier-neutral"}">${card.qualityText}</div>
            </div>
          </div>
          ${
            card.leaderTags?.length
              ? `
                <div class="tradez-compare-leader-row">
                  ${card.leaderTags
                    .map(
                      (tag) => `
                        <span class="tradez-compare-leader-tag">${tag}</span>
                      `
                    )
                    .join("")}
                </div>
              `
              : ""
          }
          <div class="tradez-compare-stats">
            ${card.stats
              .map(
                (stat) => `
                  <div class="tradez-compare-stat ${stat.isLeader ? "is-leader" : ""}">
                    <span>${stat.label}</span>
                    <strong class="${stat.tone || "neutral"}">${stat.value}</strong>
                    ${stat.isLeader ? `<small class="tradez-compare-stat-tag">Leader</small>` : ""}
                  </div>
                `
              )
              .join("")}
          </div>
          ${
            Number.isFinite(card.overallScore)
              ? `<div class="tradez-compare-overall-note">Weighted edge score ${card.overallScore.toFixed(1)} from return, win rate, and quality.</div>`
              : ""
          }
          <p class="monitor-subtle">${card.note}</p>
        </article>
      `
    )
    .join("");
}

function renderTradezAutoTabs() {
  if (!dom.auto2TabPositions) return;
  dom.auto2TabPositions.classList.toggle("is-active", tradezPaper.activeTab === "positions");
  dom.auto2TabTrades.classList.toggle("is-active", tradezPaper.activeTab === "trades");
  dom.auto2TabDemo?.classList.toggle("is-active", tradezPaper.activeTab === "demo");
  dom.auto2TabActivity.classList.toggle("is-active", tradezPaper.activeTab === "activity");
  dom.auto2PanelPositions.hidden = tradezPaper.activeTab !== "positions";
  dom.auto2PanelTrades.hidden = tradezPaper.activeTab !== "trades";
  if (dom.auto2PanelDemo) dom.auto2PanelDemo.hidden = tradezPaper.activeTab !== "demo";
  dom.auto2PanelActivity.hidden = tradezPaper.activeTab !== "activity";

  if (dom.auto2TabNote) {
    dom.auto2TabNote.textContent =
      tradezPaper.activeTab === "positions"
        ? "Live EMA Signals positions stay visible with entry, TP1, TP2, SL, and live return."
        : tradezPaper.activeTab === "trades"
          ? "The journal records each closed Auto Trade 2 position with planned levels and realized result."
          : tradezPaper.activeTab === "demo"
            ? "Binance demo entry and bracket orders stay visible here with order ids, staging status, and exchange feedback."
          : "Engine actions log detections, entries, TP1 protection, exits, and network retries.";
  }
}

function tradezPaperReservedMargin() {
  return tradezPaper.openTrades.reduce((sum, trade) => sum + (Number(trade.marginUsed) || 0), 0);
}

function tradezPaperHasOpenTrade(symbol) {
  return tradezPaper.openTrades.some((trade) => trade.symbol === symbol);
}

function tradezPaperRecentlyClosed(symbol) {
  return tradezPaper.closedTrades.some(
    (trade) => trade.symbol === symbol && Date.now() - Number(trade.closedAt || 0) < TRADEZ_AUTO_TRADE_COOLDOWN_MS
  );
}

function tradezPaperReturnPct(trade, exitPrice) {
  const direction = trade.side === "Short" ? -1 : 1;
  return pctChange(trade.entryPrice, exitPrice) * direction * (trade.leverage || TRADEZ_AUTO_LEVERAGE);
}

function logTradezPaperActivity(message, tone = "neutral") {
  tradezPaper.activity.unshift({
    time: Date.now(),
    message,
    tone,
  });
  tradezPaper.activity = tradezPaper.activity.slice(0, 30);
}

function inferTradezLegacyBookBaseline(book) {
  const startingBalance = Number(book?.startingBalance);
  const balance = Number(book?.balance);
  if (Number.isFinite(startingBalance) && startingBalance > 0 && startingBalance < TRADEZ_AUTO_START_BALANCE) {
    return startingBalance;
  }
  if (
    Number.isFinite(startingBalance) &&
    startingBalance >= TRADEZ_AUTO_START_BALANCE &&
    Number.isFinite(balance) &&
    balance > 0 &&
    balance < TRADEZ_AUTO_START_BALANCE * 0.2
  ) {
    return 200;
  }
  return null;
}

function normalizeTradezResearchBook(book) {
  const legacyBaseline = inferTradezLegacyBookBaseline(book);
  const storedStarting = Number(book?.startingBalance) || legacyBaseline || TRADEZ_AUTO_START_BALANCE;
  const storedBalance = Number(book?.balance);
  const realizedDelta = Number.isFinite(storedBalance) ? storedBalance - storedStarting : 0;

  let didRebase = false;
  let rebaseMessage = "";

  if (storedStarting !== TRADEZ_AUTO_START_BALANCE) {
    book.startingBalance = TRADEZ_AUTO_START_BALANCE;
    book.balance = TRADEZ_AUTO_START_BALANCE + realizedDelta;
    didRebase = true;
    rebaseMessage =
      "EMA Book research capital was rebased to the $1,000 baseline while preserving realized PnL.";
  } else if (!Number.isFinite(storedBalance)) {
    book.balance = TRADEZ_AUTO_START_BALANCE;
    didRebase = true;
  }

  if (!book.lastDailyBriefingUtcDate) {
    book.lastDailyBriefingUtcDate = utcDayKey(Date.now() - UTC_DAY_MS);
  }

  if ((Number(book.strategyVersion) || 1) < TRADEZ_AUTO_VERSION) {
    book.strategyVersion = TRADEZ_AUTO_VERSION;
    didRebase = true;
  }

  return {
    didRebase,
    rebaseMessage,
  };
}

function applyTradezPaperUpgradeNotice() {
  const { didRebase, rebaseMessage } = normalizeTradezResearchBook(tradezPaper);
  if (!didRebase) return;
  logTradezPaperActivity(rebaseMessage, "neutral");
  persistTradezPaperState();
}

function buildTradezAutoCandidate(candidate) {
  const signal = candidate.activeSignal;
  if (!signal) return null;

  const plannedEntry = average([signal.entryLow, signal.entryHigh]);
  const structuralStop = signal.stopLoss;
  const maxMarginStopPct = 10 / TRADEZ_AUTO_LEVERAGE;
  const cappedStop =
    signal.side === "Long"
      ? plannedEntry * (1 - maxMarginStopPct / 100)
      : plannedEntry * (1 + maxMarginStopPct / 100);
  const stopLoss =
    signal.side === "Long"
      ? Math.max(structuralStop, cappedStop)
      : Math.min(structuralStop, cappedStop);
  const stopMarginPct = Math.abs(pctChange(plannedEntry, stopLoss)) * TRADEZ_AUTO_LEVERAGE;
  const tp1 = signal.tp1;
  const tp2 = signal.tp2;
  const tp2MarginPct = Math.abs(pctChange(plannedEntry, tp2)) * TRADEZ_AUTO_LEVERAGE;
  const rr = Math.abs(tp1 - plannedEntry) / Math.max(Math.abs(plannedEntry - stopLoss), 0.0000001);

  return {
    ...candidate,
    paperTrade: {
      plannedEntry,
      entryZoneLow: Math.min(signal.entryLow, signal.entryHigh),
      entryZoneHigh: Math.max(signal.entryLow, signal.entryHigh),
      stopLoss,
      tp1,
      tp2,
      leverage: TRADEZ_AUTO_LEVERAGE,
      targetMarginPct: tp2MarginPct,
      stopMarginPct,
      rr,
    },
  };
}

function candidateIsAtLiveEntry(candidate) {
  const plan = candidate.paperTrade;
  if (!plan || !Number.isFinite(candidate.currentPrice)) return false;
  const atrBuffer = Math.max((candidate.latestAtr || 0) * LIVE_ENTRY_BUFFER_ATR, 0);
  return (
    candidate.currentPrice >= plan.entryZoneLow - atrBuffer &&
    candidate.currentPrice <= plan.entryZoneHigh + atrBuffer
  );
}

function signalIsAtLiveEntry(signal, currentPrice) {
  if (!signal || !Number.isFinite(currentPrice)) return false;
  const entryLow = Math.min(signal.entryLow, signal.entryHigh);
  const entryHigh = Math.max(signal.entryLow, signal.entryHigh);
  return currentPrice >= entryLow && currentPrice <= entryHigh;
}

function highQualityTradezAutoCandidates(candidates, threshold) {
  const executionThreshold = Math.max(
    TRADEZ_AUTO_MIN_EXECUTION_THRESHOLD,
    Number(threshold || 0) + TRADEZ_AUTO_EXECUTION_THRESHOLD_BUFFER
  );
  return candidates
    .map(buildTradezAutoCandidate)
    .filter(Boolean)
    .filter((candidate) => candidate.qualityScore >= executionThreshold)
    .filter((candidate) => candidate.paperTrade.targetMarginPct >= 20 && candidate.paperTrade.targetMarginPct <= 55)
    .filter((candidate) => candidate.paperTrade.rr >= MIN_EXECUTION_RR)
    .filter((candidate) => (candidate.activeSignal?.sinceTouchBars || 0) <= MAX_AUTO_ENTRY_SIGNAL_BARS)
    .filter(
      (candidate) =>
        (candidate.activeSignal?.flowConfirmations || 0) >= 2 ||
        ((candidate.activeSignal?.flowConfirmations || 0) >= 1 && candidate.qualityScore >= executionThreshold + 8)
    )
    .filter((candidate) => (candidate.activeSignal?.retestCount || 0) <= 2)
    .filter(
      (candidate) =>
        !Number.isFinite(candidate.activeSignal?.testedLevel) ||
        Math.abs((candidate.currentPrice || 0) - candidate.activeSignal.testedLevel) <=
          candidate.latestAtr * MAX_EXECUTION_DISTANCE_FROM_TOUCH_ATR
    )
    .filter((candidate) => (candidate.activeSignal?.volumeFactor || 0) >= MIN_AUTO_EXECUTION_VOLUME_FACTOR)
    .filter((candidate) => candidate.activeSignal?.higherTimeframeConfirmed)
    .filter(
      (candidate) =>
        !Number.isFinite(candidate.activeSignal?.extensionFromTouch) ||
        candidate.activeSignal.extensionFromTouch <= candidate.latestAtr * MAX_POST_TOUCH_EXTENSION_ATR
    )
    .filter(candidateIsAtLiveEntry)
    .sort((left, right) => {
      const rightSeen = right.identifiedAt || right.activeSignal?.detectedAt || 0;
      const leftSeen = left.identifiedAt || left.activeSignal?.detectedAt || 0;
      return right.qualityScore - left.qualityScore || rightSeen - leftSeen;
    });
}

function openTradezPaperTrade(candidate) {
  if (tradezPaperHasOpenTrade(candidate.symbol)) return false;
  if (tradezPaper.openTrades.length >= TRADEZ_AUTO_MAX_CONCURRENT_TRADES) return false;
  if (!candidateIsAtLiveEntry(candidate)) return false;

  const freeCapital = Math.max(tradezPaper.balance - tradezPaperReservedMargin(), 0);
  if (freeCapital < 10) return false;

  const actualEntry = candidate.currentPrice;
  const slotsRemaining = Math.max(1, TRADEZ_AUTO_MAX_CONCURRENT_TRADES - tradezPaper.openTrades.length);
  const marginBudget = Math.min(
    freeCapital,
    Math.max(tradezPaper.startingBalance * 0.03, freeCapital / slotsRemaining)
  );
  const riskCapital = Math.max(marginBudget * 0.12, 2);
  const stopDistance = Math.abs(actualEntry - candidate.paperTrade.stopLoss);
  const quantityByRisk = stopDistance > 0 ? riskCapital / stopDistance : 0;
  const quantityByCapital = (marginBudget * candidate.paperTrade.leverage) / actualEntry;
  const quantity = Math.max(0, Math.min(quantityByRisk, quantityByCapital));
  if (!Number.isFinite(quantity) || quantity <= 0) return false;

  const trade = {
    id: `${Date.now()}-ema-${candidate.symbol}`,
    strategyLabel: "Auto Trade 2",
    symbol: candidate.symbol,
    token: candidate.token,
    side: candidate.activeSignal.side,
    touch: candidate.activeSignal.touch,
    strength: candidate.activeSignal.strength,
    entryPrice: actualEntry,
    entryZoneLow: candidate.paperTrade.entryZoneLow,
    entryZoneHigh: candidate.paperTrade.entryZoneHigh,
    stopLoss: candidate.paperTrade.stopLoss,
    tp1: candidate.paperTrade.tp1,
    tp2: candidate.paperTrade.tp2,
    currentTarget: candidate.paperTrade.tp1,
    tp1Hit: false,
    quantity,
    leverage: candidate.paperTrade.leverage,
    marginUsed: marginBudget,
    qualityScore: candidate.qualityScore,
    rr: candidate.paperTrade.rr,
    entryReason: tradezEntryReason(candidate),
    keyDetails: tradezKeyDetails(candidate),
    signalNote: candidate.activeSignal.note,
    pricePrecision: candidate.pricePrecision,
    detectedAt: candidate.identifiedAt || candidate.activeSignal.detectedAt || Date.now(),
    openedAt: Date.now(),
    lastPrice: candidate.currentPrice,
    breakEvenArmed: false,
    executionMode: tradezDelivery.mode,
  };
  tradezPaper.openTrades.push(trade);
  logTradezSignalOpened(candidate, trade);
  logTradezTradeEvent("opened", trade, {
    eventSuffix: "opened",
    eventTime: trade.openedAt,
    metadata: {
      quoteVolume: Number(universeTickerMap.get(candidate.symbol)?.quoteVolume) || 0,
      rr: candidate.paperTrade?.rr || null,
      targetMarginPct: candidate.paperTrade?.targetMarginPct || null,
      stopMarginPct: candidate.paperTrade?.stopMarginPct || null,
      reasonParts: candidate.activeSignal?.reasonParts || [],
      identifiedAt: candidate.identifiedAt || candidate.activeSignal?.detectedAt || null,
    },
  });

  logTradezPaperActivity(
    `Opened Auto Trade 2 ${candidate.activeSignal.side} ${candidate.symbol} • entry ${formatPrice(
      actualEntry,
      candidate.pricePrecision
    )} • zone ${formatPrice(candidate.paperTrade.entryZoneLow, candidate.pricePrecision)} - ${formatPrice(
      candidate.paperTrade.entryZoneHigh,
      candidate.pricePrecision
    )} • TP1 ${formatPrice(candidate.paperTrade.tp1, candidate.pricePrecision)} • TP2 ${formatPrice(
      candidate.paperTrade.tp2,
      candidate.pricePrecision
    )} • SL ${formatPrice(candidate.paperTrade.stopLoss, candidate.pricePrecision)} • Q${candidate.qualityScore}.`,
    candidate.activeSignal.tone
  );
  if (tradezDelivery.mode === "demo") {
    const demoRecordId = `demo-${trade.id}`;
    trade.demoJournalId = demoRecordId;
    trade.demoStatus = "SUBMITTING";
    pushTradezDemoOrder({
      id: demoRecordId,
      createdAt: Date.now(),
      detectedAt: trade.detectedAt,
      symbol: trade.symbol,
      side: trade.side,
      touch: trade.touch,
      qualityScore: trade.qualityScore,
      leverage: trade.leverage,
      quantity: trade.quantity,
      status: "SUBMITTING",
      pricePrecision: candidate.pricePrecision,
      entryPrice: trade.entryPrice,
      tp1: trade.tp1,
      tp2: trade.tp2,
      stopLoss: trade.stopLoss,
      executionMode: "demo",
      entryOrder: null,
      tp1Order: null,
      tp2Order: null,
      stopOrder: null,
      warnings: [],
      error: "",
    });
    persistTradezPaperState();
    renderTradezPaperDashboard();
    sendTradezDemoOrder(candidate, trade)
      .then((result) => {
        trade.demoOrderId = result.entryOrder?.orderId || result.orderId || null;
        trade.demoEntryOrderId = result.entryOrder?.orderId || null;
        trade.demoTp1OrderId = result.tp1Order?.orderId || null;
        trade.demoTp2OrderId = result.tp2Order?.orderId || null;
        trade.demoStopOrderId = result.stopOrder?.orderId || null;
        trade.demoStatus = result.overallStatus || result.entryOrder?.status || result.status || "NEW";
        trade.demoEnvironment = result.environment || "binance-demo";
        updateTradezDemoOrder(demoRecordId, (record) => ({
          ...record,
          status: result.overallStatus || record.status,
          entryOrder: result.entryOrder || record.entryOrder,
          tp1Order: result.tp1Order || record.tp1Order,
          tp2Order: result.tp2Order || record.tp2Order,
          stopOrder: result.stopOrder || record.stopOrder,
          warnings: Array.isArray(result.warnings) ? result.warnings : [],
          error: "",
          leverage: result.leverage || record.leverage,
          quantity: Number(result.executedQty) || record.quantity,
        }));
        persistTradezPaperState();
        logTradezPaperActivity(
          `Binance demo bracket staged for ${candidate.symbol} • entry ${result.entryOrder?.orderId || "pending"} • status ${
            result.overallStatus || result.entryOrder?.status || "NEW"
          }.`,
          candidate.activeSignal.tone
        );
        if (Array.isArray(result.warnings) && result.warnings.length) {
          logTradezPaperActivity(
            `Binance demo warnings for ${candidate.symbol} • ${result.warnings.join(" • ")}`,
            "down"
          );
        }
        renderTradezPaperDashboard();
      })
      .catch((error) => {
        trade.demoStatus = "ERROR";
        updateTradezDemoOrder(demoRecordId, (record) => ({
          ...record,
          status: "ERROR",
          error: error.message,
        }));
        persistTradezPaperState();
        logTradezPaperActivity(
          `Binance demo order failed for ${candidate.symbol} • ${error.message}`,
          "down"
        );
        renderTradezPaperDashboard();
      });
  }
  maybeSendTradezEntryNotification(candidate, trade);
  return trade;
}

function closeTradezPaperTrade(tradeId, reason, exitPrice, precisionHint) {
  const index = tradezPaper.openTrades.findIndex((trade) => trade.id === tradeId);
  if (index === -1) return null;

  const trade = tradezPaper.openTrades[index];
  const direction = trade.side === "Short" ? -1 : 1;
  const pnlUsd = (exitPrice - trade.entryPrice) * trade.quantity * direction;
  const returnPct = tradezPaperReturnPct(trade, exitPrice);
  tradezPaper.balance += pnlUsd;

  const closedTrade = {
    ...trade,
    exitPrice,
    closedAt: Date.now(),
    reason,
    pnlUsd,
    returnPct,
    balanceAfter: tradezPaper.balance,
  };
  tradezPaper.closedTrades.unshift(closedTrade);
  tradezPaper.closedTrades = tradezPaper.closedTrades.slice(0, 100);
  tradezPaper.openTrades.splice(index, 1);
  logTradezTradeEvent(
    reason === "TP" ? "tp_hit" : reason === "BE" ? "break_even_exit" : "sl_hit",
    closedTrade,
    {
      eventSuffix: reason.toLowerCase(),
      eventTime: closedTrade.closedAt,
      closedAt: closedTrade.closedAt,
      exitPrice: closedTrade.exitPrice,
      returnPct: closedTrade.returnPct,
      pnlUsd: closedTrade.pnlUsd,
      balanceAfter: closedTrade.balanceAfter,
      metadata: {
        closeReason: reason,
      },
    }
  );

  logTradezPaperActivity(
    `${reason} closed Auto Trade 2 ${trade.side} ${trade.symbol} • entry ${formatPrice(
      trade.entryPrice,
      precisionHint
    )} • exit ${formatPrice(exitPrice, precisionHint)} • ${formatPercent(returnPct)} on margin • ${formatCompactUsd(
      pnlUsd,
      2
    )}.`,
    reason === "TP" ? "up" : reason === "BE" ? "neutral" : "down"
  );
  return closedTrade;
}

function markTradezLocalDemoStatus(trade, status, checkedAt = Date.now(), warning = "") {
  if (!trade?.demoJournalId) return;
  updateTradezDemoOrder(trade.demoJournalId, (record) => ({
    ...record,
    status,
    checkedAt,
    warnings: warning
      ? uniqueValues([...(Array.isArray(record.warnings) ? record.warnings : []), warning])
      : record.warnings || [],
  }));
}

function refreshTradezPaperTrades(candidates) {
  if (!tradezPaper.openTrades.length) return;
  const candidateLookup = new Map(candidates.map((candidate) => [candidate.symbol, candidate]));

  [...tradezPaper.openTrades].forEach((trade) => {
    const candidate = candidateLookup.get(trade.symbol);
    if (!candidate) return;

    trade.lastPrice = candidate.currentPrice;
    trade.pricePrecision = candidate.pricePrecision;
    const currentPrice = candidate.currentPrice;
    const liveMarginPct = tradezPaperReturnPct(trade, currentPrice);
    const hitTp1 =
      !trade.tp1Hit &&
      ((trade.side === "Long" ? currentPrice >= trade.tp1 : currentPrice <= trade.tp1) ||
        liveMarginPct >= TRADEZ_AUTO_TP1_MARGIN_TRIGGER_PCT);
    const hitTp2 =
      trade.side === "Long" ? currentPrice >= trade.tp2 : currentPrice <= trade.tp2;
    const hitStop =
      trade.side === "Long" ? currentPrice <= trade.stopLoss : currentPrice >= trade.stopLoss;

    if (hitTp1) {
      trade.tp1Hit = true;
      trade.stopLoss = trade.entryPrice;
      trade.currentTarget = trade.tp2;
      if (trade.executionMode === "demo") {
        trade.demoTp1Notified = true;
        markTradezLocalDemoStatus(
          trade,
          "TP1_FILLED",
          Date.now(),
          "Local price crossed TP1 before exchange sync confirmed the fill."
        );
      }
      logTradezPaperActivity(
        `${trade.symbol} hit TP1. Stop moved to entry while the runner targets ${formatPrice(
          trade.tp2,
          candidate.pricePrecision
        )}.`,
        trade.side === "Long" ? "up" : "down"
      );
      logTradezTradeEvent("tp1_hit", trade, {
        eventSuffix: "tp1",
        eventTime: Date.now(),
        metadata: {
          exitType: "tp1",
          demoSync: trade.executionMode === "demo",
          runnerTarget: trade.tp2,
          triggeredByMarginPct: liveMarginPct >= TRADEZ_AUTO_TP1_MARGIN_TRIGGER_PCT ? liveMarginPct : null,
        },
      });
      maybeSendTradezProgressNotification(
        "tp1",
        trade,
        [
          `TP1 hit: ${formatPrice(trade.tp1, candidate.pricePrecision)}`,
          `Stop moved to entry: ${formatPrice(trade.entryPrice, candidate.pricePrecision)}`,
          `Runner target: ${formatPrice(trade.tp2, candidate.pricePrecision)}`,
        ],
        Date.now()
      );
    }

    if (hitTp2) {
      const closedTrade = closeTradezPaperTrade(trade.id, "TP", trade.tp2, candidate.pricePrecision);
      if (closedTrade) {
        if (trade.executionMode === "demo") {
          markTradezLocalDemoStatus(
            trade,
            "TP2_FILLED",
            closedTrade.closedAt,
            "Local price crossed TP2 before exchange sync confirmed the fill."
          );
        }
        maybeSendTradezProgressNotification(
          "tp",
          closedTrade,
          [
            `Exit: ${formatPrice(closedTrade.exitPrice, candidate.pricePrecision)}`,
            `Return: ${formatPercent(closedTrade.returnPct || 0)}`,
            `PnL: ${formatCompactUsd(closedTrade.pnlUsd || 0, 2)}`,
          ],
          closedTrade.closedAt
        );
      }
    } else if (hitStop) {
      const closeReason = trade.tp1Hit ? "BE" : "SL";
      const closedTrade = closeTradezPaperTrade(trade.id, closeReason, trade.stopLoss, candidate.pricePrecision);
      if (closedTrade) {
        if (trade.executionMode === "demo") {
          markTradezLocalDemoStatus(
            trade,
            closeReason === "BE" ? "SL_FILLED" : "SL_FILLED",
            closedTrade.closedAt,
            "Local price crossed the stop before exchange sync confirmed the fill."
          );
        }
        maybeSendTradezProgressNotification(
          closeReason === "BE" ? "be" : "sl",
          closedTrade,
          [
            `Exit: ${formatPrice(closedTrade.exitPrice, candidate.pricePrecision)}`,
            `Return: ${formatPercent(closedTrade.returnPct || 0)}`,
            `PnL: ${formatCompactUsd(closedTrade.pnlUsd || 0, 2)}`,
          ],
          closedTrade.closedAt
        );
      }
    }
  });
}

function openTradezQualifiedTrades(candidates) {
  const eligible = highQualityTradezAutoCandidates(candidates, state.qualityThreshold).filter(
    (candidate) => !tradezPaperHasOpenTrade(candidate.symbol) && !tradezPaperRecentlyClosed(candidate.symbol)
  );

  const opened = [];
  for (const candidate of eligible) {
    if (opened.length >= TRADEZ_AUTO_MAX_NEW_TRADES) break;
    if (tradezPaper.openTrades.length >= TRADEZ_AUTO_MAX_CONCURRENT_TRADES) break;
    if (openTradezPaperTrade(candidate)) opened.push(candidate);
  }
  return opened;
}

function readHouseTradeMetrics() {
  const stored = readStoredJson(HOUSE_AUTO_STORAGE_KEY, {});
  const openTrades = Array.isArray(stored.openTrades) ? stored.openTrades : [];
  const closedTrades = Array.isArray(stored.closedTrades) ? stored.closedTrades : [];
  const startingBalance = Number(stored.startingBalance) || 1000;
  const realizedBalance = Number(stored.balance) || startingBalance;
  const tpCount = closedTrades.filter((trade) => trade.reason === "TP").length;
  const slCount = closedTrades.filter((trade) => trade.reason === "SL").length;
  const totalClosed = closedTrades.length;
  const winRate = totalClosed ? (tpCount / totalClosed) * 100 : 0;
  const unrealizedUsd = openTrades.reduce((sum, trade) => {
    const direction = trade.side === "Short" ? -1 : 1;
    if (!Number.isFinite(trade.lastPrice) || !Number.isFinite(trade.entryPrice) || !Number.isFinite(trade.quantity)) {
      return sum;
    }
    return sum + (trade.lastPrice - trade.entryPrice) * trade.quantity * direction;
  }, 0);
  const equity = realizedBalance + unrealizedUsd;
  const averageQuality = average(
    [...openTrades, ...closedTrades].map((trade) => Number(trade.qualityScore)).filter(Number.isFinite)
  );
  return {
    title: "Auto Trade",
    startingBalance,
    realizedBalance,
    realizedPnl: realizedBalance - startingBalance,
    unrealizedUsd,
    equity,
    totalReturnPct: pctChange(startingBalance, equity),
    tradesTaken: openTrades.length + closedTrades.length,
    openTrades: openTrades.length,
    tpCount,
    slCount,
    winRate,
    averageQuality: Number.isFinite(averageQuality) ? averageQuality : 0,
    note:
      openTrades.length
        ? `${openTrades.length} live house position${openTrades.length > 1 ? "s" : ""} still open.`
        : "House engine currently has no open position.",
  };
}

function readTradezPaperMetrics() {
  const tpCount = tradezPaper.closedTrades.filter((trade) => trade.reason === "TP").length;
  const slCount = tradezPaper.closedTrades.filter((trade) => trade.reason === "SL").length;
  const beCount = tradezPaper.closedTrades.filter((trade) => trade.reason === "BE").length;
  const resolvedCount = tpCount + slCount;
  const totalClosed = tradezPaper.closedTrades.length;
  const winRate = resolvedCount ? (tpCount / resolvedCount) * 100 : 0;
  const unrealizedUsd = tradezPaper.openTrades.reduce((sum, trade) => {
    const direction = trade.side === "Short" ? -1 : 1;
    if (!Number.isFinite(trade.lastPrice)) return sum;
    return sum + (trade.lastPrice - trade.entryPrice) * trade.quantity * direction;
  }, 0);
  const equity = tradezPaper.balance + unrealizedUsd;
  const averageQuality = average(
    [...tradezPaper.openTrades, ...tradezPaper.closedTrades].map((trade) => Number(trade.qualityScore)).filter(Number.isFinite)
  );
  return {
    title: "Auto Trade 2",
    startingBalance: tradezPaper.startingBalance,
    realizedBalance: tradezPaper.balance,
    realizedPnl: tradezPaper.balance - tradezPaper.startingBalance,
    totalReturnPct: pctChange(tradezPaper.startingBalance, equity),
    tradesTaken: tradezPaper.openTrades.length + tradezPaper.closedTrades.length,
    openTrades: tradezPaper.openTrades.length,
    tpCount,
    slCount,
    beCount,
    resolvedCount,
    winRate,
    averageQuality: Number.isFinite(averageQuality) ? averageQuality : 0,
    equity,
    unrealizedUsd,
    note:
      tradezPaper.openTrades.length
        ? `${tradezPaper.openTrades.length} live EMA position${tradezPaper.openTrades.length > 1 ? "s" : ""} still open.`
        : "EMA Signals engine currently has no open position.",
  };
}

function normalizedReturnScore(returnPct) {
  return Math.max(0, Math.min(100, 50 + returnPct * 2));
}

function normalizedQualityScore(quality) {
  return Math.max(0, Math.min(100, (quality / 160) * 100));
}

function overallLeaderScore(metrics) {
  const returnScore = normalizedReturnScore(metrics.totalReturnPct || 0);
  const winScore = Math.max(0, Math.min(100, metrics.winRate || 0));
  const qualityScore = normalizedQualityScore(metrics.averageQuality || 0);
  return returnScore * 0.45 + winScore * 0.35 + qualityScore * 0.2;
}

function renderTradezComparison() {
  const house = readHouseTradeMetrics();
  const auto2 = readTradezPaperMetrics();
  const houseOverallScore = overallLeaderScore(house);
  const auto2OverallScore = overallLeaderScore(auto2);
  const houseLeadsReturn = house.totalReturnPct > auto2.totalReturnPct;
  const auto2LeadsReturn = auto2.totalReturnPct > house.totalReturnPct;
  const houseLeadsWin = house.winRate > auto2.winRate;
  const auto2LeadsWin = auto2.winRate > house.winRate;
  const houseLeadsQuality = house.averageQuality > auto2.averageQuality;
  const auto2LeadsQuality = auto2.averageQuality > house.averageQuality;
  const houseOverallLeader = houseOverallScore > auto2OverallScore;
  const auto2OverallLeader = auto2OverallScore > houseOverallScore;

  renderCompareCards([
    {
      label: "Benchmark",
      title: house.title,
      qualityText: `Q${Math.round(house.averageQuality || 0)}`,
      qualityClass: qualityTier(house.averageQuality || 0).className,
      tone: "neutral",
      overallScore: houseOverallScore,
      isOverallLeader: houseOverallLeader,
      leaderTags: [
        houseOverallLeader ? "Overall Leader" : "",
        houseLeadsReturn ? "Leads Return" : "",
        houseLeadsWin ? "Leads Win %" : "",
        houseLeadsQuality ? "Leads Quality" : "",
      ].filter(Boolean),
      note: house.note,
      stats: [
        { label: "Opening Bal", value: formatCompactUsd(house.startingBalance, 2) },
        {
          label: "Total Return",
          value: formatPercent(house.totalReturnPct),
          tone: toneFromNumber(house.totalReturnPct, 0.01),
          isLeader: houseLeadsReturn,
        },
        { label: "Current Balance", value: formatCompactUsd(house.equity, 2), tone: toneFromNumber(house.equity - house.startingBalance, 0.01) },
        { label: "Realized PnL", value: formatCompactUsd(house.realizedPnl, 2), tone: toneFromNumber(house.realizedPnl, 0.01) },
        { label: "Unrealized PnL", value: formatCompactUsd(house.unrealizedUsd, 2), tone: toneFromNumber(house.unrealizedUsd, 0.01) },
        { label: "Trades Taken", value: `${house.tradesTaken}` },
        { label: "TPs Hit", value: `${house.tpCount}`, tone: "up" },
        { label: "SLs Hit", value: `${house.slCount}`, tone: "down" },
        { label: "Win %", value: `${house.winRate.toFixed(0)}%`, tone: toneFromNumber(house.winRate - 50, 2), isLeader: houseLeadsWin },
        { label: "Open", value: `${house.openTrades}` },
        { label: "Avg Quality", value: `${Math.round(house.averageQuality || 0)}`, isLeader: houseLeadsQuality },
      ],
    },
    {
      label: "EMA Book",
      title: auto2.title,
      qualityText: `Q${Math.round(auto2.averageQuality || 0)}`,
      qualityClass: qualityTier(auto2.averageQuality || 0).className,
      tone: "neutral",
      overallScore: auto2OverallScore,
      isOverallLeader: auto2OverallLeader,
      leaderTags: [
        auto2OverallLeader ? "Overall Leader" : "",
        auto2LeadsReturn ? "Leads Return" : "",
        auto2LeadsWin ? "Leads Win %" : "",
        auto2LeadsQuality ? "Leads Quality" : "",
      ].filter(Boolean),
      note: `${auto2.note}${auto2.beCount ? ` ${auto2.beCount} trade${auto2.beCount > 1 ? "s" : ""} moved to breakeven after TP1.` : ""}`,
      stats: [
        { label: "Opening Bal", value: formatCompactUsd(auto2.startingBalance, 2) },
        {
          label: "Total Return",
          value: formatPercent(auto2.totalReturnPct),
          tone: toneFromNumber(auto2.totalReturnPct, 0.01),
          isLeader: auto2LeadsReturn,
        },
        { label: "Current Balance", value: formatCompactUsd(auto2.equity, 2), tone: toneFromNumber(auto2.equity - auto2.startingBalance, 0.01) },
        { label: "Realized PnL", value: formatCompactUsd(auto2.realizedPnl, 2), tone: toneFromNumber(auto2.realizedPnl, 0.01) },
        { label: "Unrealized PnL", value: formatCompactUsd(auto2.unrealizedUsd, 2), tone: toneFromNumber(auto2.unrealizedUsd, 0.01) },
        { label: "Trades Taken", value: `${auto2.tradesTaken}` },
        { label: "TPs Hit", value: `${auto2.tpCount}`, tone: "up" },
        { label: "SLs Hit", value: `${auto2.slCount}`, tone: "down" },
        { label: "Win %", value: `${auto2.winRate.toFixed(0)}%`, tone: toneFromNumber(auto2.winRate - 50, 2), isLeader: auto2LeadsWin },
        { label: "Open", value: `${auto2.openTrades}` },
        { label: "Avg Quality", value: `${Math.round(auto2.averageQuality || 0)}`, isLeader: auto2LeadsQuality },
      ],
    },
  ]);
}

function renderTradezPaperDashboard() {
  const metrics = readTradezPaperMetrics();
  const realizedPnl = tradezPaper.balance - tradezPaper.startingBalance;
  const visibleOpenTrades = [...tradezPaper.openTrades].sort(
    (left, right) => (right.openedAt || 0) - (left.openedAt || 0)
  );
  const recentTradeCutoff = Date.now() - 10 * 60 * 1000;

  if (dom.auto2MetricStart) dom.auto2MetricStart.textContent = formatPrice(tradezPaper.startingBalance, 2);
  if (dom.auto2MetricEquity) {
    dom.auto2MetricEquity.textContent = formatPrice(metrics.equity, 2);
    dom.auto2MetricEquity.className = toneFromNumber(metrics.equity - tradezPaper.startingBalance, 0.01);
  }
  if (dom.auto2MetricEquityNote) {
    dom.auto2MetricEquityNote.textContent = tradezPaper.openTrades.length
      ? `${tradezPaper.openTrades.length} open positions • unrealized ${formatCompactUsd(metrics.unrealizedUsd, 2)}`
      : "No open position";
  }
  if (dom.auto2MetricRealized) {
    dom.auto2MetricRealized.textContent = formatCompactUsd(realizedPnl, 2);
    dom.auto2MetricRealized.className = toneFromNumber(realizedPnl, 0.01);
  }
  if (dom.auto2MetricRealizedNote) {
    dom.auto2MetricRealizedNote.textContent = `${formatPercent(pctChange(tradezPaper.startingBalance, tradezPaper.balance))} vs start`;
  }
  if (dom.auto2MetricWinRate) {
    dom.auto2MetricWinRate.textContent = `${metrics.winRate.toFixed(0)}%`;
    dom.auto2MetricWinRate.className = toneFromNumber(metrics.winRate - 50, 2);
  }
  if (dom.auto2MetricWinRateNote) {
    dom.auto2MetricWinRateNote.textContent = metrics.beCount
      ? `${metrics.tpCount} winners / ${metrics.resolvedCount} resolved trades • ${metrics.beCount} BE`
      : `${metrics.tpCount} winners / ${metrics.resolvedCount} resolved trades`;
  }
  if (dom.auto2MetricOpen) {
    dom.auto2MetricOpen.textContent = tradezPaper.openTrades.length ? `${tradezPaper.openTrades.length} Active` : "None";
    dom.auto2MetricOpen.className = tradezPaper.openTrades.length
      ? toneFromNumber(metrics.unrealizedUsd, 0.01)
      : "neutral";
  }
  if (dom.auto2MetricOpenNote) {
    const lead = visibleOpenTrades[0];
    dom.auto2MetricOpenNote.textContent = lead
      ? `${lead.symbol} ${lead.side} • TP1 ${formatPrice(lead.tp1, lead.pricePrecision || 2)} • TP2 ${formatPrice(
          lead.tp2,
          lead.pricePrecision || 2
        )} • SL ${formatPrice(lead.stopLoss, lead.pricePrecision || 2)}`
      : "Waiting for EMA setup";
  }
  if (dom.auto2MetricLastScan) {
    dom.auto2MetricLastScan.textContent = tradezPaper.lastScanAt ? formatClock(tradezPaper.lastScanAt) : "-";
  }
  if (dom.auto2MetricLastScanNote) {
    dom.auto2MetricLastScanNote.textContent = tradezPaper.autoEnabled
      ? remoteRuntimeEnabled
        ? "EMA book scans every 5m on the background runtime"
        : "EMA book scans every 5m in parallel"
      : "EMA book paused";
  }
  if (dom.auto2Toggle) dom.auto2Toggle.textContent = tradezPaper.autoEnabled ? "Pause Auto 2" : "Resume Auto 2";
  if (dom.auto2Note) {
    dom.auto2Note.textContent = tradezPaper.autoEnabled
      ? remoteRuntimeEnabled
        ? `Auto Trade 2 scans every 5 minutes on the shared background runtime, can open up to ${TRADEZ_AUTO_MAX_NEW_TRADES} fresh trades per pass, can hold up to ${TRADEZ_AUTO_MAX_CONCURRENT_TRADES} EMA positions, and is running on the $${TRADEZ_AUTO_START_BALANCE.toLocaleString()} research book in ${tradezModeLabel()} mode.`
        : `Auto Trade 2 scans every 5 minutes, can open up to ${TRADEZ_AUTO_MAX_NEW_TRADES} fresh trades per pass, can hold up to ${TRADEZ_AUTO_MAX_CONCURRENT_TRADES} EMA positions, and is running on the $${TRADEZ_AUTO_START_BALANCE.toLocaleString()} research book in ${tradezModeLabel()} mode.`
      : `Auto Trade 2 is paused. The feed still monitors EMA setups while the $${TRADEZ_AUTO_START_BALANCE.toLocaleString()} research book stays armed in ${tradezModeLabel()} mode.`;
  }

  renderAnalysisGrid(
    dom.auto2OpenGrid,
    visibleOpenTrades.length
      ? visibleOpenTrades.map((trade) => ({
          label: `${trade.symbol} ${trade.side}`,
          value: `${formatPercent(tradezPaperReturnPct(trade, trade.lastPrice || trade.entryPrice))} live`,
          badge: trade.openedAt && trade.openedAt >= recentTradeCutoff ? "Recently Opened" : "",
          badgeClass: trade.openedAt && trade.openedAt >= recentTradeCutoff ? "recent" : "",
          note: `Opened ${formatExactDateTime(trade.openedAt)} • Entered ${formatPrice(
            trade.entryPrice,
            trade.pricePrecision || 2
          )} • Current ${formatPrice(trade.lastPrice || trade.entryPrice, trade.pricePrecision || 2)} • TP1 ${formatPrice(
            trade.tp1,
            trade.pricePrecision || 2
          )} • TP2 ${formatPrice(trade.tp2, trade.pricePrecision || 2)} • SL ${formatPrice(
            trade.stopLoss,
            trade.pricePrecision || 2
          )} • ${trade.touch} • ${tradeExecutionLabel(trade.executionMode)}`,
          tone: toneFromNumber(tradezPaperReturnPct(trade, trade.lastPrice || trade.entryPrice), 0.01),
        }))
      : [
          {
            label: "Engine waiting",
            value: "No open trade",
            note: "Auto Trade 2 will open the next high-quality EMA Signals setup automatically.",
            tone: "neutral",
          },
        ]
  );

  renderTable(
    dom.auto2TradeTable,
    tradezPaper.closedTrades.slice(0, 14).map((trade) => ({
      label: `${trade.symbol} ${trade.side} • ${trade.reason}`,
      primary: `Entry ${formatPrice(trade.entryPrice, trade.pricePrecision || 2)} • Exit ${formatPrice(
        trade.exitPrice,
        trade.pricePrecision || 2
      )}`,
      secondaryLabel: "Plan",
      secondary: `TP1 ${formatPrice(trade.tp1, trade.pricePrecision || 2)} • TP2 ${formatPrice(
        trade.tp2,
        trade.pricePrecision || 2
      )} • SL ${formatPrice(trade.stopLoss, trade.pricePrecision || 2)}`,
      tertiaryLabel: "Result",
      tertiary: `${formatPercent(trade.returnPct || 0)} on margin • ${formatCompactUsd(
        trade.pnlUsd,
        2
      )} • Bal ${formatPrice(trade.balanceAfter, 2)}`,
      tone: trade.reason === "TP" ? "up" : trade.reason === "BE" ? "neutral" : "down",
    })),
    "No closed Auto Trade 2 trades yet"
  );

  renderTable(
    dom.auto2DemoTable,
    tradezPaper.demoOrders.slice(0, 14).map((record) => {
      const statusTone = formatDemoOrderStatus(record.status).tone;
      const warnings = Array.isArray(record.warnings) && record.warnings.length ? ` • warnings ${record.warnings.length}` : "";
      const error = record.error ? ` • ${record.error}` : "";
      const positionAmt = Number(record.position?.positionAmt) || 0;
      const positionSummary = Number.isFinite(positionAmt)
        ? ` • Pos ${positionAmt.toFixed(4)} @ ${formatPrice(Number(record.position?.markPrice) || 0, record.pricePrecision || 2)}`
        : "";
      return {
        label: `${record.symbol} ${record.side} • ${formatDemoOrderStatus(record.status).label}`,
        primary: `${formatDateTime(record.createdAt)} • ${tradeExecutionLabel(record.executionMode)} • ${record.leverage}x • Q${Math.round(record.qualityScore || 0)}${positionSummary}`,
        secondaryLabel: "Orders",
        secondary: `Entry ${describeDemoBracket(record.entryOrder)} • TP1 ${describeDemoBracket(record.tp1Order)} • TP2 ${describeDemoBracket(record.tp2Order)} • SL ${describeDemoBracket(record.stopOrder)}`,
        tertiaryLabel: "Levels",
        tertiary: `Entry ${formatPrice(record.entryPrice, record.pricePrecision || 2)} • TP1 ${formatPrice(record.tp1, record.pricePrecision || 2)} • TP2 ${formatPrice(record.tp2, record.pricePrecision || 2)} • SL ${formatPrice(record.stopLoss, record.pricePrecision || 2)} • Sync ${formatDateTime(record.checkedAt || record.createdAt)}${warnings}${error}`,
        tone: statusTone,
      };
    }),
    "No Binance demo orders staged yet"
  );

  renderTable(
    dom.auto2ActivityTable,
    tradezPaper.activity.slice(0, 14).map((item) => ({
      label: new Date(item.time).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      primary: item.message,
      secondaryLabel: "Mode",
      secondary: tradezPaper.autoEnabled ? "Auto" : "Manual",
      tertiaryLabel: "Status",
      tertiary: item.tone === "up" ? "Constructive" : item.tone === "down" ? "Defensive" : "Watching",
      tone: item.tone,
    })),
    "No Auto Trade 2 activity yet"
  );

  renderTradezAutoTabs();
  renderTradezComparison();
}

function mapKlineEntry(entry) {
  return {
    time: Math.floor(Number(entry[0]) / 1000),
    open: Number(entry[1]),
    high: Number(entry[2]),
    low: Number(entry[3]),
    close: Number(entry[4]),
    volume: Number(entry[5]),
  };
}

function ema(values, period) {
  if (values.length < period) return [];
  const multiplier = 2 / (period + 1);
  const seed = average(values.slice(0, period));
  const result = new Array(period - 1).fill(null);
  let current = seed;
  result.push(seed);

  for (let index = period; index < values.length; index += 1) {
    current = values[index] * multiplier + current * (1 - multiplier);
    result.push(current);
  }

  return result;
}

function rsi(values, period = 14) {
  if (values.length <= period) return [];
  const result = new Array(period).fill(null);
  let gains = 0;
  let losses = 0;

  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }

  return result;
}

function atr(candles, period = 14) {
  if (candles.length <= period) return [];
  const trueRanges = [];

  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previousClose = candles[index - 1].close;
    trueRanges.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previousClose),
        Math.abs(current.low - previousClose)
      )
    );
  }

  const result = new Array(period).fill(null);
  let currentAtr = average(trueRanges.slice(0, period));
  result.push(currentAtr);

  for (let index = period; index < trueRanges.length; index += 1) {
    currentAtr = (currentAtr * (period - 1) + trueRanges[index]) / period;
    result.push(currentAtr);
  }

  return result;
}

function computeSupportResistance(candles, currentPrice, latestAtr) {
  const supports = [];
  const resistances = [];
  const lookback = 3;

  for (let index = lookback; index < candles.length - lookback; index += 1) {
    const candle = candles[index];
    const previous = candles.slice(index - lookback, index);
    const next = candles.slice(index + 1, index + 1 + lookback);

    if (previous.every((item) => candle.low <= item.low) && next.every((item) => candle.low <= item.low)) {
      supports.push(candle.low);
    }
    if (previous.every((item) => candle.high >= item.high) && next.every((item) => candle.high >= item.high)) {
      resistances.push(candle.high);
    }
  }

  const clusterThreshold = Math.max(latestAtr * 0.7, currentPrice * 0.0035);
  const clusterLevels = (levels) =>
    levels
      .sort((left, right) => left - right)
      .reduce((groups, level) => {
        const lastGroup = groups[groups.length - 1];
        if (!lastGroup || Math.abs(lastGroup.center - level) > clusterThreshold) {
          groups.push({ levels: [level], center: level });
          return groups;
        }
        lastGroup.levels.push(level);
        lastGroup.center = average(lastGroup.levels);
        return groups;
      }, [])
      .map((group) => group.center);

  function uniqueDirectionalLevels(baseLevels, fallbackLevels, direction) {
    const sorted = [...baseLevels];
    const orderedFallback = [...fallbackLevels].sort((left, right) =>
      direction === "support" ? right - left : left - right
    );

    orderedFallback.forEach((level) => {
      if (
        !sorted.some((existing) => Math.abs(existing - level) <= Math.max(clusterThreshold * 0.65, 0.0000001))
      ) {
        sorted.push(level);
      }
    });

    return sorted
      .filter((level) => (direction === "support" ? level < currentPrice : level > currentPrice))
      .sort((left, right) => (direction === "support" ? right - left : left - right))
      .slice(0, 2);
  }

  const recentWindow = candles.slice(-Math.min(candles.length, 90));
  const clusteredSupports = clusterLevels(supports).filter((level) => level < currentPrice);
  const clusteredResistances = clusterLevels(resistances).filter((level) => level > currentPrice);
  const fallbackSupports = clusterLevels(recentWindow.map((candle) => candle.low)).filter(
    (level) => level < currentPrice
  );
  const fallbackResistances = clusterLevels(recentWindow.map((candle) => candle.high)).filter(
    (level) => level > currentPrice
  );

  const recentHigh = recentWindow.length ? Math.max(...recentWindow.map((candle) => candle.high)) : currentPrice;
  const recentLow = recentWindow.length ? Math.min(...recentWindow.map((candle) => candle.low)) : currentPrice;
  const projectionUnit = Math.max(
    clusterThreshold * 1.2,
    latestAtr * 0.9,
    Math.abs(recentHigh - recentLow) * 0.16
  );

  let supportLevels = uniqueDirectionalLevels(clusteredSupports, fallbackSupports, "support");
  let resistanceLevels = uniqueDirectionalLevels(clusteredResistances, fallbackResistances, "resistance");

  while (supportLevels.length < 2) {
    const anchor = supportLevels[supportLevels.length - 1] ?? currentPrice;
    supportLevels.push(anchor - projectionUnit * (supportLevels.length === 0 ? 1 : 0.9));
  }

  while (resistanceLevels.length < 2) {
    const anchor = resistanceLevels[resistanceLevels.length - 1] ?? currentPrice;
    resistanceLevels.push(anchor + projectionUnit * (resistanceLevels.length === 0 ? 1 : 0.9));
  }

  return {
    supportLevels: supportLevels.sort((left, right) => right - left).slice(0, 2),
    resistanceLevels: resistanceLevels.sort((left, right) => left - right).slice(0, 2),
    bandWidth: clusterThreshold / 2,
  };
}

function normalizeTrade(rawTrade) {
  const price = Number(rawTrade.p || rawTrade.price);
  const quantity = Number(rawTrade.q || rawTrade.quantity);
  return {
    price,
    quantity,
    quoteNotional: price * quantity,
    isSellInitiated: Boolean(rawTrade.m ?? rawTrade.isSellInitiated),
  };
}

function analyzeTradeTape(trades) {
  const normalizedTrades = (trades || []).map(normalizeTrade);
  if (!normalizedTrades.length) {
    return {
      totalBuyNotional: 0,
      totalSellNotional: 0,
      netLargeFlow: 0,
      cvdSlope: 0,
    };
  }

  const notionals = normalizedTrades.map((trade) => trade.quoteNotional);
  const whaleCutoff = percentile(notionals, 0.9);
  let cumulativeDelta = 0;
  const cvdSeries = [];

  const summary = normalizedTrades.reduce(
    (accumulator, trade) => {
      cumulativeDelta += trade.quoteNotional * (trade.isSellInitiated ? -1 : 1);
      cvdSeries.push(cumulativeDelta);

      if (trade.isSellInitiated) accumulator.totalSellNotional += trade.quoteNotional;
      else accumulator.totalBuyNotional += trade.quoteNotional;

      if (trade.quoteNotional >= whaleCutoff) {
        accumulator.netLargeFlow += trade.isSellInitiated ? -trade.quoteNotional : trade.quoteNotional;
      }

      return accumulator;
    },
    {
      totalBuyNotional: 0,
      totalSellNotional: 0,
      netLargeFlow: 0,
    }
  );

  return {
    ...summary,
    cvdSlope: slopePercentage(cvdSeries, 40),
  };
}

function analyzeOrderbook(rawDepth, referencePrice) {
  const bids = (rawDepth?.bids || []).slice(0, 25).map(([price, quantity]) => ({
    price: Number(price),
    quantity: Number(quantity),
    notional: Number(price) * Number(quantity),
  }));
  const asks = (rawDepth?.asks || []).slice(0, 25).map(([price, quantity]) => ({
    price: Number(price),
    quantity: Number(quantity),
    notional: Number(price) * Number(quantity),
  }));
  const bidSum = bids.reduce((sum, level) => sum + level.notional, 0);
  const askSum = asks.reduce((sum, level) => sum + level.notional, 0);
  return {
    imbalance: bidSum + askSum === 0 ? 0 : (bidSum - askSum) / (bidSum + askSum),
    spreadBps:
      bids[0] && asks[0] && referencePrice
        ? ((asks[0].price - bids[0].price) / referencePrice) * 10000
        : 0,
  };
}

function analyzeTakerLongShort(entries) {
  const parsed = (entries || []).map((entry) => ({
    buySellRatio: Number(entry.buySellRatio),
  }));
  const latest = parsed[parsed.length - 1];
  return {
    latestRatio: latest?.buySellRatio || 1,
  };
}

async function fetchJson(url, label) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`${label} failed (${response.status})`);
  }

  return response.json();
}

async function fetchDirectJson(url, label) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${label} failed (${response.status})`);
  return response.json();
}

async function getExchangeInfo() {
  if (exchangeInfoCache) return exchangeInfoCache;
  try {
    exchangeInfoCache = await fetchJson("https://fapi.binance.com/fapi/v1/exchangeInfo", "Exchange info");
  } catch (error) {
    const fallback = getFallbackExchangeInfo();
    if (!fallback) throw error;
    exchangeInfoCache = fallback;
  }
  return exchangeInfoCache;
}

async function getPerpUniverse() {
  if (perpUniverseCache) return perpUniverseCache;
  const exchangeInfo = await getExchangeInfo();
  perpUniverseCache = perpUniverseSymbols(exchangeInfo).sort((left, right) => left.symbol.localeCompare(right.symbol));
  return perpUniverseCache;
}

function mapUniverseTickers(entries, activeSymbols) {
  return (entries || [])
    .filter((entry) => activeSymbols.has(entry.symbol))
    .map((entry) => ({
      symbol: entry.symbol,
      lastPrice: Number(entry.lastPrice ?? entry.price ?? entry.markPrice),
      changePct: Number(entry.priceChangePercent) || 0,
      quoteVolume: Number(entry.quoteVolume) || 0,
      volume: Number(entry.volume) || 0,
    }));
}

function loadStoredTickers(activeSymbols) {
  const stored = readStoredJson(TICKER_STORAGE_KEY, null);
  if (!stored || !Array.isArray(stored.tickers) || !stored.savedAt) return null;
  if (Date.now() - Number(stored.savedAt) > TICKER_CACHE_MAX_AGE_MS) return null;
  return mapUniverseTickers(stored.tickers, activeSymbols);
}

function persistTickers(tickers) {
  writeStoredJson(TICKER_STORAGE_KEY, {
    savedAt: Date.now(),
    tickers,
  });
}

async function fetchUniverseTickersDirect(activeSymbols) {
  const tickers = await fetchJson("https://fapi.binance.com/fapi/v1/ticker/24hr", "24H tickers");
  return mapUniverseTickers(tickers, activeSymbols);
}

async function fetchUniverseTickersServer(activeSymbols) {
  const response = await fetch(new URL("/api/arena-universe", window.location.origin));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Arena ticker proxy failed (${response.status})`);
  return mapUniverseTickers(payload.tickers || [], activeSymbols);
}

async function fetchUniversePricesFallback(activeSymbols) {
  const prices = await fetchJson("https://fapi.binance.com/fapi/v1/ticker/price", "Ticker prices");
  return mapUniverseTickers(prices, activeSymbols);
}

function buildShellTickers(activeSymbols) {
  return Array.from(activeSymbols).map((symbol) => ({
    symbol,
    lastPrice: 0,
    changePct: 0,
    quoteVolume: 0,
    volume: 0,
  }));
}

async function fetchUniverseTickers() {
  const universe = await getPerpUniverse();
  const activeSymbols = new Set(universe.map((item) => item.symbol));
  const cachedTickers = loadStoredTickers(activeSymbols);

  try {
    const tickers = await fetchUniverseTickersDirect(activeSymbols);
    persistTickers(tickers);
    return tickers;
  } catch (directError) {
    try {
      const tickers = await fetchUniverseTickersServer(activeSymbols);
      if (tickers.length) persistTickers(tickers);
      return tickers;
    } catch (serverError) {
      if (cachedTickers?.length) return cachedTickers;
      try {
        return await fetchUniversePricesFallback(activeSymbols);
      } catch (priceError) {
        return buildShellTickers(activeSymbols);
      }
    }
  }
}

async function fetchServerSnapshot(token) {
  const requestUrl = new URL("/api/market", window.location.origin);
  requestUrl.searchParams.set("token", normalizeToken(token));
  requestUrl.searchParams.set("interval", STRATEGY_INTERVAL);
  const response = await fetch(requestUrl);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Server snapshot failed");
  return payload;
}

function buildSpotCoreSymbolCandidates(resolved) {
  const candidates = [resolved.symbol];
  if (!/^\d/.test(resolved.baseAsset || "")) {
    candidates.push(`${resolved.baseAsset}${QUOTE_ASSET}`);
    candidates.push(`${resolved.cleanedToken}${QUOTE_ASSET}`);
  }
  return Array.from(new Set(candidates.filter(Boolean)));
}

async function fetchFirstSuccessful(candidates, loader) {
  for (const candidate of candidates) {
    try {
      const value = await loader(candidate);
      if (value) return value;
    } catch (error) {
      // Try the next symbol variant.
    }
  }
  return null;
}

async function fetchSpotCoreSnapshotDirect(resolved) {
  const candidates = buildSpotCoreSymbolCandidates(resolved);
  return fetchFirstSuccessful(candidates, async (symbol) => {
    const requests = await Promise.allSettled([
      fetchDirectJson(
        `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${STRATEGY_INTERVAL}&limit=240`,
        "Spot klines"
      ),
      fetchDirectJson(
        `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`,
        "Spot 24H ticker"
      ),
      fetchDirectJson(
        `https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=100`,
        "Spot orderbook"
      ),
      fetchDirectJson(
        `https://api.binance.com/api/v3/aggTrades?symbol=${symbol}&limit=400`,
        "Spot agg trades"
      ),
    ]);

    const [klinesResult, tickerResult, depthResult, tradesResult] = requests;
    if (klinesResult.status !== "fulfilled" || tickerResult.status !== "fulfilled") {
      throw new Error(`Spot core data unavailable for ${symbol}`);
    }

    return {
      symbol,
      candles: klinesResult.value.map(mapKlineEntry),
      ticker: tickerResult.value,
      depth: depthResult.status === "fulfilled" ? depthResult.value : { bids: [], asks: [] },
      trades: tradesResult.status === "fulfilled" ? tradesResult.value : [],
    };
  });
}

async function fetchDirectSnapshot(token) {
  const exchangeInfo = await getExchangeInfo();
  const resolved = resolvePerpSymbol(token, exchangeInfo);

  const requests = await Promise.allSettled([
    fetchDirectJson(
      `https://fapi.binance.com/fapi/v1/klines?symbol=${resolved.symbol}&interval=${STRATEGY_INTERVAL}&limit=240`,
      "Klines"
    ),
    fetchDirectJson(
      `https://fapi.binance.com/fapi/v1/klines?symbol=${resolved.symbol}&interval=${HIGHER_TIMEFRAME_INTERVAL}&limit=180`,
      "Higher timeframe klines"
    ),
    fetchDirectJson(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${resolved.symbol}`, "Ticker"),
    fetchDirectJson(`https://fapi.binance.com/fapi/v1/depth?symbol=${resolved.symbol}&limit=100`, "Depth"),
    fetchDirectJson(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=${resolved.symbol}&limit=400`, "Trades"),
    fetchDirectJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${resolved.symbol}`, "Premium"),
    fetchDirectJson(
      `https://fapi.binance.com/futures/data/openInterestHist?symbol=${resolved.symbol}&period=5m&limit=60`,
      "OI history"
    ),
    fetchDirectJson(
      `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${resolved.symbol}&period=1h&limit=24`,
      "Global L/S"
    ),
    fetchDirectJson(
      `https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${resolved.symbol}&period=5m&limit=24`,
      "Taker ratio"
    ),
  ]);

  const [
    klinesResult,
    higherTimeframeKlinesResult,
    tickerResult,
    depthResult,
    tradesResult,
    premiumResult,
    oiHistoryResult,
    globalResult,
    takerResult,
  ] = requests;

  let candles;
  let candles4h;
  let ticker;
  let depth;
  let trades;

  if (klinesResult.status === "fulfilled" && tickerResult.status === "fulfilled") {
    candles = klinesResult.value.map(mapKlineEntry);
    candles4h =
      higherTimeframeKlinesResult.status === "fulfilled"
        ? higherTimeframeKlinesResult.value.map(mapKlineEntry)
        : aggregateCandles(candles, 4);
    ticker = tickerResult.value;
    depth = depthResult.status === "fulfilled" ? depthResult.value : { bids: [], asks: [] };
    trades = tradesResult.status === "fulfilled" ? tradesResult.value : [];
  } else {
    const spotCore = await fetchSpotCoreSnapshotDirect(resolved).catch(() => null);
    if (!spotCore) {
      throw new Error(`Core perpetual market data is unavailable for ${resolved.symbol}.`);
    }
    candles = spotCore.candles;
    candles4h = aggregateCandles(candles, 4);
    ticker = spotCore.ticker;
    depth = spotCore.depth;
    trades = spotCore.trades;
  }

  return {
    token: resolved.cleanedToken,
    symbol: resolved.symbol,
    baseAsset: resolved.baseAsset,
    pricePrecision: resolved.pricePrecision,
    candles,
    candles4h,
    ticker,
    depth,
    trades,
    premiumIndex: premiumResult.status === "fulfilled" ? premiumResult.value : null,
    openInterestHistory: oiHistoryResult.status === "fulfilled" ? oiHistoryResult.value : [],
    globalLongShort: globalResult.status === "fulfilled" ? globalResult.value : [],
    takerLongShort: takerResult.status === "fulfilled" ? takerResult.value : [],
  };
}

async function fetchEngineSnapshot(token) {
  try {
    return await fetchDirectSnapshot(token);
  } catch (error) {
    return fetchServerSnapshot(token);
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(runners);
  return results;
}

function buildTickerLookup(tickers) {
  return new Map(tickers.map((entry) => [entry.symbol, entry]));
}

function aggregateCandles(candles, bucketSize) {
  if (!Array.isArray(candles) || !candles.length || bucketSize <= 1) return candles || [];
  const aggregated = [];

  for (let index = 0; index < candles.length; index += bucketSize) {
    const bucket = candles.slice(index, index + bucketSize).filter(Boolean);
    if (!bucket.length) continue;
    const open = bucket[0];
    const close = bucket[bucket.length - 1];
    aggregated.push({
      time: open.time,
      open: open.open,
      high: Math.max(...bucket.map((entry) => Number(entry.high) || Number.NEGATIVE_INFINITY)),
      low: Math.min(...bucket.map((entry) => Number(entry.low) || Number.POSITIVE_INFINITY)),
      close: close.close,
      volume: bucket.reduce((sum, entry) => sum + (Number(entry.volume) || 0), 0),
    });
  }

  return aggregated.filter(
    (candle) =>
      Number.isFinite(candle.open) &&
      Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.close)
  );
}

function selectUniverseBatch(universe) {
  const ranked = [...universe].sort((left, right) => {
    const leftTicker = universeTickerMap.get(left.symbol);
    const rightTicker = universeTickerMap.get(right.symbol);
    return (rightTicker?.quoteVolume || 0) - (leftTicker?.quoteVolume || 0);
  });

  const mustTrackSymbols = new Set(
    [
      state.selectedSymbol,
      `${normalizeToken(state.selectedToken || DEFAULT_TOKEN)}${QUOTE_ASSET}`,
      ...tradezPaper.openTrades.map((trade) => trade.symbol),
      ...tradezPaper.demoOrders
        .filter((record) => record?.status && !["FILLED", "CANCELED", "EXPIRED", "REJECTED"].includes(String(record.status).toUpperCase()))
        .map((record) => record.symbol),
    ].filter(Boolean)
  );
  const mustTrack = ranked.filter((item) => mustTrackSymbols.has(item.symbol));
  const priority = ranked.slice(0, PRIORITY_SCAN_COUNT);
  const rotationPool = ranked.slice(PRIORITY_SCAN_COUNT);
  const rotationBatch = [];

  if (rotationPool.length) {
    const start = scanCursor % rotationPool.length;
    for (let index = 0; index < Math.min(ROTATION_SCAN_COUNT, rotationPool.length); index += 1) {
      rotationBatch.push(rotationPool[(start + index) % rotationPool.length]);
    }
    scanCursor = (start + ROTATION_SCAN_COUNT) % rotationPool.length;
  }

  return Array.from(new Map([...mustTrack, ...priority, ...rotationBatch].map((item) => [item.symbol, item])).values());
}

function touchLabel(touch20, touch50) {
  if (touch20 && touch50) return "EMA20/50";
  if (touch20) return "EMA20";
  if (touch50) return "EMA50";
  return "EMA zone";
}

function touchesLevel(candle, level, tolerance) {
  if (!Number.isFinite(level)) return false;
  return candle.low <= level + tolerance && candle.high >= level - tolerance;
}

function wickTouchesLevel(candle, level, side, touchBuffer) {
  if (!candle || !Number.isFinite(level)) return false;
  if (side === "Long") return candle.low <= level + touchBuffer;
  return candle.high >= level - touchBuffer;
}

function levelLabel(side, useLevelTwo) {
  if (side === "Long") return useLevelTwo ? "S2" : "S1";
  return useLevelTwo ? "R2" : "R1";
}

function buildConfluenceLabel(side, useLevelTwo, touch20, touch50) {
  const level = levelLabel(side, useLevelTwo);
  if (touch20 && touch50) return `EMA20/50 + ${level}`;
  if (touch20) return `EMA20 + ${level}`;
  if (touch50) return `EMA50 + ${level}`;
  return level;
}

function rangePosition(candle, side) {
  const candleRange = Math.max(candle.high - candle.low, 0.0000001);
  if (side === "Long") return (candle.close - candle.low) / candleRange;
  return (candle.high - candle.close) / candleRange;
}

function emaSlopeAligned(series, index, side, atrValue, lookback = EMA_SLOPE_LOOKBACK) {
  let supportive = 0;
  let comparisons = 0;
  let netChange = 0;
  const minimumDelta = Math.max((Number(atrValue) || 0) * 0.015, 0);

  for (let cursor = Math.max(1, index - lookback + 1); cursor <= index; cursor += 1) {
    const current = series[cursor];
    const previous = series[cursor - 1];
    if (!Number.isFinite(current) || !Number.isFinite(previous)) continue;
    const delta = current - previous;
    netChange += delta;
    comparisons += 1;
    if (side === "Long" ? delta >= -minimumDelta : delta <= minimumDelta) supportive += 1;
  }

  if (comparisons < 3) return false;
  if (supportive < comparisons - 1) return false;
  return side === "Long" ? netChange > minimumDelta * 2 : netChange < -minimumDelta * 2;
}

function wickRejectedLevel(candle, level, side, touchBuffer, reclaimBuffer) {
  if (!candle || !Number.isFinite(level)) return false;
  const range = Math.max(candle.high - candle.low, 0.0000001);
  const body = Math.abs(candle.close - candle.open);
  const lowerWick = Math.max(Math.min(candle.open, candle.close) - candle.low, 0);
  const upperWick = Math.max(candle.high - Math.max(candle.open, candle.close), 0);

  if (side === "Long") {
    return wickTouchesLevel(candle, level, side, touchBuffer) && candle.close > level + reclaimBuffer && lowerWick > body * 0.65;
  }

  return wickTouchesLevel(candle, level, side, touchBuffer) && candle.close < level - reclaimBuffer && upperWick > body * 0.65;
}

function countFlowConfirmations(side, tradeSummary, takerSummary, depthSummary) {
  let confirmations = 0;
  if (side === "Long") {
    if (tradeSummary.cvdSlope > 0) confirmations += 1;
    if (takerSummary.latestRatio > 1.01) confirmations += 1;
    if (depthSummary.imbalance > 0.01) confirmations += 1;
  } else {
    if (tradeSummary.cvdSlope < 0) confirmations += 1;
    if (takerSummary.latestRatio < 0.99) confirmations += 1;
    if (depthSummary.imbalance < -0.01) confirmations += 1;
  }
  return confirmations;
}

function countLevelRetests(candles, level, side, tolerance, endIndex, window = 36) {
  if (!Number.isFinite(level)) return 0;
  let touches = 0;
  let inTouch = false;
  const start = Math.max(0, endIndex - window);

  for (let index = start; index <= endIndex; index += 1) {
    const touched = wickTouchesLevel(candles[index], level, side, tolerance);
    if (touched && !inTouch) touches += 1;
    inTouch = touched;
  }

  return touches;
}

function postTouchExtension(candles, startIndex, endIndex, level, side) {
  if (!Number.isFinite(level) || endIndex <= startIndex) return 0;
  const segment = candles.slice(startIndex + 1, endIndex + 1);
  if (!segment.length) return 0;
  if (side === "Long") {
    return Math.max(...segment.map((entry) => Math.max((Number(entry.high) || level) - level, 0)));
  }
  return Math.max(...segment.map((entry) => Math.max(level - (Number(entry.low) || level), 0)));
}

function buildSetupBias(currentPrice, latestEma20, latestEma50, latestRsi) {
  let score = 0;
  score += currentPrice > latestEma20 ? 10 : -10;
  score += latestEma20 > latestEma50 ? 14 : -14;
  score += latestRsi >= 50 && latestRsi <= 68 ? 8 : latestRsi < 45 ? -8 : 0;

  if (score >= 16) return { label: "Bullish", tone: "up", summary: "Trend stack still favors bullish pullbacks." };
  if (score <= -16) return { label: "Bearish", tone: "down", summary: "Trend stack still favors bearish pullbacks." };
  return { label: "Balanced", tone: "neutral", summary: "Trend stack is mixed, so pullback quality is lower." };
}

function buildTradezSignals(snapshot, quoteVolume = 0) {
  const candles = (snapshot.candles || []).map((candle) => ({ ...candle }));
  const higherTimeframeCandles =
    Array.isArray(snapshot.candles4h) && snapshot.candles4h.length
      ? snapshot.candles4h.map((candle) => ({ ...candle }))
      : aggregateCandles(candles, 4);
  const closes = candles.map((candle) => candle.close);
  const higherTimeframeCloses = higherTimeframeCandles.map((candle) => candle.close);
  const currentPrice = Number(snapshot.premiumIndex?.markPrice) || Number(snapshot.ticker?.lastPrice) || closes[closes.length - 1] || 0;
  const ema20Series = ema(closes, 20);
  const ema50Series = ema(closes, 50);
  const rsiSeries = rsi(closes, 14);
  const atrSeries = atr(candles, 14);
  const higherTimeframeEma20Series = ema(higherTimeframeCloses, 20);
  const higherTimeframeEma50Series = ema(higherTimeframeCloses, 50);
  const higherTimeframeRsiSeries = rsi(higherTimeframeCloses, 14);
  const latestEma20 = latestDefinedValue(ema20Series) ?? currentPrice;
  const latestEma50 = latestDefinedValue(ema50Series) ?? currentPrice;
  const latestRsi = latestDefinedValue(rsiSeries) ?? 50;
  const latestAtr = latestDefinedValue(atrSeries) ?? currentPrice * 0.01;
  const higherTimeframeEma20 = latestDefinedValue(higherTimeframeEma20Series) ?? latestEma20;
  const higherTimeframeEma50 = latestDefinedValue(higherTimeframeEma50Series) ?? latestEma50;
  const higherTimeframeRsi = latestDefinedValue(higherTimeframeRsiSeries) ?? latestRsi;
  const supportResistance = computeSupportResistance(candles, currentPrice, latestAtr);
  const tradeSummary = analyzeTradeTape(snapshot.trades || []);
  const depthSummary = analyzeOrderbook(snapshot.depth || { bids: [], asks: [] }, currentPrice);
  const takerSummary = analyzeTakerLongShort(snapshot.takerLongShort || []);
  const oiHistory = (snapshot.openInterestHistory || []).map((entry) => Number(entry.sumOpenInterest));
  const oiChange1h = pctChangeFromLookback(oiHistory, 12);
  const fundingRate = (Number(snapshot.premiumIndex?.lastFundingRate) || 0) * 100;
  const longFlowConfirmations = countFlowConfirmations("Long", tradeSummary, takerSummary, depthSummary);
  const shortFlowConfirmations = countFlowConfirmations("Short", tradeSummary, takerSummary, depthSummary);
  const buyerLed = longFlowConfirmations === 3;
  const sellerLed = shortFlowConfirmations === 3;
  const higherTimeframeLongConfirmed =
    higherTimeframeEma20 > higherTimeframeEma50 && higherTimeframeRsi > 50;
  const higherTimeframeShortConfirmed =
    higherTimeframeEma20 < higherTimeframeEma50 && higherTimeframeRsi < 50;
  const bias = buildSetupBias(currentPrice, latestEma20, latestEma50, latestRsi);
  const completedLimit = Math.max(55, candles.length - 10);
  const markers = [];
  const historicalSignals = [];
  let activeSignal = null;
  const [support1, support2] = supportResistance.supportLevels;
  const [resistance1, resistance2] = supportResistance.resistanceLevels;

  for (let index = completedLimit; index < candles.length - 1; index += 1) {
    const candle = candles[index];
    const nextCandle = candles[index + 1];
    const ema20Value = ema20Series[index];
    const ema50Value = ema50Series[index];
    const atrValue = atrSeries[index] ?? latestAtr;
    const rsiValue = rsiSeries[index] ?? latestRsi;

    if (!Number.isFinite(ema20Value) || !Number.isFinite(ema50Value) || !Number.isFinite(atrValue)) continue;

    const bullishTrend = ema20Value > ema50Value;
    const bearishTrend = ema20Value < ema50Value;
    const tolerance = Math.max(atrValue * 0.16, candle.close * 0.0012, supportResistance.bandWidth * 0.45);
    const strictLevelTouchBuffer = Math.max(
      atrValue * STRICT_LEVEL_TOUCH_BUFFER_ATR,
      candle.close * 0.00035,
      supportResistance.bandWidth * 0.12
    );
    const strictLevelReclaimBuffer = Math.max(
      atrValue * STRICT_LEVEL_RECLAIM_BUFFER_ATR,
      candle.close * 0.0002,
      strictLevelTouchBuffer * 0.55
    );
    const emaSeparationAtr = Math.abs(ema20Value - ema50Value) / Math.max(atrValue, 0.0000001);
    const touch20 = candle.low <= ema20Value + tolerance && candle.high >= ema20Value - tolerance;
    const touch50 = candle.low <= ema50Value + tolerance && candle.high >= ema50Value - tolerance;
    const previousCandle = candles[index - 1];
    const currentLongTouchS1 = wickRejectedLevel(candle, support1, "Long", strictLevelTouchBuffer, strictLevelReclaimBuffer);
    const currentLongTouchS2 = wickRejectedLevel(candle, support2, "Long", strictLevelTouchBuffer, strictLevelReclaimBuffer);
    const previousLongTouchS1 = wickRejectedLevel(previousCandle, support1, "Long", strictLevelTouchBuffer, strictLevelReclaimBuffer);
    const previousLongTouchS2 = wickRejectedLevel(previousCandle, support2, "Long", strictLevelTouchBuffer, strictLevelReclaimBuffer);
    const currentShortTouchR1 = wickRejectedLevel(candle, resistance1, "Short", strictLevelTouchBuffer, strictLevelReclaimBuffer);
    const currentShortTouchR2 = wickRejectedLevel(candle, resistance2, "Short", strictLevelTouchBuffer, strictLevelReclaimBuffer);
    const previousShortTouchR1 = wickRejectedLevel(previousCandle, resistance1, "Short", strictLevelTouchBuffer, strictLevelReclaimBuffer);
    const previousShortTouchR2 = wickRejectedLevel(previousCandle, resistance2, "Short", strictLevelTouchBuffer, strictLevelReclaimBuffer);
    const averageVolume20 = average(candles.slice(Math.max(0, index - 20), index).map((entry) => entry.volume).filter(Boolean));
    const previousAverageVolume20 =
      previousCandle
        ? average(candles.slice(Math.max(0, index - 21), index - 1).map((entry) => entry.volume).filter(Boolean))
        : 0;
    const volumeFactor = averageVolume20 ? candle.volume / averageVolume20 : 1;
    const previousVolumeFactor = previousAverageVolume20 ? previousCandle.volume / previousAverageVolume20 : 1;
    const bullishVolumeConfirmed =
      candle.close > candle.open &&
      volumeFactor >= MIN_VISIBLE_SIGNAL_VOLUME_FACTOR &&
      rangePosition(candle, "Long") >= 0.56 &&
      (!nextCandle || nextCandle.close >= candle.close * 0.996);
    const previousBullishVolumeConfirmed =
      previousCandle &&
      previousCandle.close > previousCandle.open &&
      previousVolumeFactor >= MIN_VISIBLE_SIGNAL_VOLUME_FACTOR &&
      rangePosition(previousCandle, "Long") >= 0.56 &&
      candle.close >= previousCandle.close * 0.996;
    const bearishVolumeConfirmed =
      candle.close < candle.open &&
      volumeFactor >= MIN_VISIBLE_SIGNAL_VOLUME_FACTOR &&
      rangePosition(candle, "Short") >= 0.56 &&
      (!nextCandle || nextCandle.close <= candle.close * 1.004);
    const previousBearishVolumeConfirmed =
      previousCandle &&
      previousCandle.close < previousCandle.open &&
      previousVolumeFactor >= MIN_VISIBLE_SIGNAL_VOLUME_FACTOR &&
      rangePosition(previousCandle, "Short") >= 0.56 &&
      candle.close <= previousCandle.close * 1.004;
    const longSlopeAligned = emaSlopeAligned(ema20Series, index, "Long", atrValue);
    const shortSlopeAligned = emaSlopeAligned(ema20Series, index, "Short", atrValue);
    const longSetup =
      bullishTrend &&
      higherTimeframeLongConfirmed &&
      longSlopeAligned &&
      emaSeparationAtr >= MIN_EMA_SEPARATION_ATR &&
      longFlowConfirmations >= 1 &&
      (
        ((currentLongTouchS1 || currentLongTouchS2) && bullishVolumeConfirmed) ||
        ((previousLongTouchS1 || previousLongTouchS2) && previousBullishVolumeConfirmed)
      );
    const shortSetup =
      bearishTrend &&
      higherTimeframeShortConfirmed &&
      shortSlopeAligned &&
      emaSeparationAtr >= MIN_EMA_SEPARATION_ATR &&
      shortFlowConfirmations >= 1 &&
      (
        ((currentShortTouchR1 || currentShortTouchR2) && bearishVolumeConfirmed) ||
        ((previousShortTouchR1 || previousShortTouchR2) && previousBearishVolumeConfirmed)
      );

    if (!longSetup && !shortSetup) continue;

    const side = longSetup ? "Long" : "Short";
    const tone = side === "Long" ? "up" : "down";
    const useLevelTwo = side === "Long"
      ? currentLongTouchS2 || previousLongTouchS2
      : currentShortTouchR2 || previousShortTouchR2;
    const touchedCandle =
      side === "Long"
        ? currentLongTouchS2 || currentLongTouchS1
          ? candle
          : previousCandle
        : currentShortTouchR2 || currentShortTouchR1
          ? candle
          : previousCandle;
    const touchIndex =
      side === "Long"
        ? currentLongTouchS2 || currentLongTouchS1
          ? index
          : index - 1
        : currentShortTouchR2 || currentShortTouchR1
          ? index
          : index - 1;
    const testedLevel = side === "Long" ? (useLevelTwo ? support2 : support1) : useLevelTwo ? resistance2 : resistance1;
    const anchorLevel = Number.isFinite(testedLevel)
      ? testedLevel
      : side === "Long"
        ? Math.min(touchedCandle.low, ema20Value, ema50Value)
        : Math.max(touchedCandle.high, ema20Value, ema50Value);
    const levelTag = levelLabel(side, useLevelTwo);
    const confluenceLabel = buildConfluenceLabel(side, useLevelTwo, touch20, touch50);
    const flowConfirmations = side === "Long" ? longFlowConfirmations : shortFlowConfirmations;
    const higherTimeframeConfirmed =
      side === "Long" ? higherTimeframeLongConfirmed : higherTimeframeShortConfirmed;
    const rejectionVolumeFactor = touchIndex === index ? volumeFactor : previousVolumeFactor;
    const softerDisplayFlowConfirmed =
      flowConfirmations >= 2 ||
      (
        flowConfirmations >= 1 &&
        higherTimeframeConfirmed &&
        hasGoodTradingVolume(quoteVolume) &&
        rejectionVolumeFactor >= MIN_VISIBLE_SIGNAL_VOLUME_FACTOR &&
        (
          side === "Long"
            ? tradeSummary.cvdSlope > 0 || takerSummary.latestRatio > 1 || depthSummary.imbalance > 0
            : tradeSummary.cvdSlope < 0 || takerSummary.latestRatio < 1 || depthSummary.imbalance < 0
        )
      );
    const rejectionRangePosition = rangePosition(touchedCandle, side);
    const wickRejected = wickRejectedLevel(touchedCandle, anchorLevel, side, strictLevelTouchBuffer, strictLevelReclaimBuffer);
    const retestCount = countLevelRetests(candles, anchorLevel, side, strictLevelTouchBuffer, touchIndex, 40);
    const emaAnchorLow = Math.min(
      anchorLevel,
      touch20 ? ema20Value : anchorLevel,
      touch50 ? ema50Value : anchorLevel,
      touchedCandle.low
    );
    const emaAnchorHigh = Math.max(
      anchorLevel,
      touch20 ? ema20Value : anchorLevel,
      touch50 ? ema50Value : anchorLevel,
      touchedCandle.high
    );
    const entryLow = side === "Long" ? emaAnchorLow - tolerance * 0.16 : Math.min(anchorLevel, candle.close) - tolerance * 0.08;
    const entryHigh = side === "Long" ? Math.max(anchorLevel, candle.close, touch20 ? ema20Value : anchorLevel, touch50 ? ema50Value : anchorLevel) + tolerance * 0.08 : emaAnchorHigh + tolerance * 0.16;
    const entryReference = average([entryLow, entryHigh]);
    const nearestSupport = support1 ?? entryReference - atrValue * 1.1;
    const secondSupport = support2 ?? nearestSupport - atrValue * 0.9;
    const nearestResistance = resistance1 ?? entryReference + atrValue * 1.1;
    const secondResistance = resistance2 ?? nearestResistance + atrValue * 0.9;
    const stopLoss =
      side === "Long"
        ? Math.min(anchorLevel, touchedCandle.low) - Math.max(supportResistance.bandWidth * 0.45, atrValue * 0.18)
        : Math.max(anchorLevel, touchedCandle.high) + Math.max(supportResistance.bandWidth * 0.45, atrValue * 0.18);
    const risk = Math.max(Math.abs(entryReference - stopLoss), atrValue * 0.55);
    const tp1 =
      side === "Long"
        ? Math.max(nearestResistance, entryReference + risk * 1.2)
        : Math.min(nearestSupport, entryReference - risk * 1.2);
    const tp2 =
      side === "Long"
        ? Math.max(secondResistance, tp1 + atrValue * 0.55)
        : Math.min(secondSupport, tp1 - atrValue * 0.55);
    const room = side === "Long" ? tp1 - entryReference : entryReference - tp1;
    const rr = Math.abs(tp1 - entryReference) / Math.max(risk, 0.0000001);
    const recentDistancePct = Math.abs(pctChange(entryReference, currentPrice));
    const sinceTouchBars = candles.length - 2 - touchIndex;
    const extensionFromTouch = postTouchExtension(candles, touchIndex, candles.length - 2, anchorLevel, side);
    const executionDistanceFromTouch = Math.abs(entryReference - anchorLevel);
    const staleSetup = sinceTouchBars > MAX_STALE_SIGNAL_BARS;
    const overextendedSetup = extensionFromTouch > atrValue * MAX_POST_TOUCH_EXTENSION_ATR;
    const chasedSetup = executionDistanceFromTouch > atrValue * MAX_EXECUTION_DISTANCE_FROM_TOUCH_ATR;
    if (!wickRejected || retestCount > 2 || staleSetup || overextendedSetup || chasedSetup || !softerDisplayFlowConfirmed) continue;
    const emaConfluenceScore = touch20 && touch50 ? 18 : touch50 ? 14 : touch20 ? 12 : 4;
    let qualityScore = 46;
    qualityScore += side === "Long" ? 18 : 18;
    qualityScore += useLevelTwo ? 20 : 12;
    qualityScore += emaConfluenceScore;
    qualityScore += emaSeparationAtr >= 0.5 ? 12 : emaSeparationAtr >= 0.32 ? 7 : -10;
    qualityScore += flowConfirmations === 3 ? 12 : 4;
    qualityScore += (side === "Long" ? touchedCandle.close > touchedCandle.open : touchedCandle.close < touchedCandle.open) ? 10 : 0;
    qualityScore += rejectionRangePosition >= 0.62 ? 8 : -6;
    qualityScore += rejectionVolumeFactor >= 1.4 ? 16 : rejectionVolumeFactor >= 1.15 ? 10 : -12;
    qualityScore += hasGoodTradingVolume(quoteVolume) ? 10 : -10;
    qualityScore += side === "Long" ? (tradeSummary.cvdSlope > 0 ? 10 : -8) : tradeSummary.cvdSlope < 0 ? 10 : -8;
    qualityScore += side === "Long" ? (depthSummary.imbalance > 0 ? 6 : -6) : depthSummary.imbalance < 0 ? 6 : -6;
    qualityScore += side === "Long" ? (takerSummary.latestRatio > 1.01 ? 8 : -6) : takerSummary.latestRatio < 0.99 ? 8 : -6;
    qualityScore += side === "Long" ? (oiChange1h > 0 ? 8 : -6) : oiChange1h > 0 ? 6 : 0;
    qualityScore += side === "Long"
      ? rsiValue >= 50 && rsiValue <= 68
        ? 8
        : rsiValue > 74
          ? -10
          : 0
      : rsiValue <= 50 && rsiValue >= 32
        ? 8
        : rsiValue < 26
          ? -10
          : 0;
    qualityScore += rr >= 1.8 ? 16 : rr >= 1.2 ? 8 : -10;
    qualityScore += room / Math.max(risk, 0.0000001) >= 1.2 ? 8 : -10;
    qualityScore -= sinceTouchBars * 4;
    qualityScore += wickRejected ? 10 : -14;
    qualityScore += retestCount === 1 ? 8 : retestCount === 2 ? 2 : -18;
    qualityScore += side === "Long"
      ? higherTimeframeLongConfirmed
        ? 10
        : -18
      : higherTimeframeShortConfirmed
        ? 10
        : -18;
    if (recentDistancePct > 1.8) qualityScore -= 14;
    if (Math.abs(fundingRate) > 0.04 && ((side === "Long" && fundingRate > 0) || (side === "Short" && fundingRate < 0))) {
      qualityScore -= 6;
    }
    const flowAligned = side === "Long" ? buyerLed : sellerLed;
    if (!hasGoodTradingVolume(quoteVolume)) qualityScore -= 18;
    if (rejectionVolumeFactor < MIN_VISIBLE_SIGNAL_VOLUME_FACTOR) qualityScore -= 12;
    if (!flowAligned) qualityScore -= 18;
    if (!touch20 && !touch50 && !useLevelTwo) qualityScore -= 10;
    if (side === "Long" && !touch20 && !touch50) qualityScore -= 8;
    if (side === "Short" && !touch20 && !touch50) qualityScore -= 4;
    if (useLevelTwo && flowAligned) qualityScore += side === "Short" ? 14 : 10;
    if (side === "Long" && tradeSummary.cvdSlope <= 0) qualityScore -= 12;
    if (side === "Short" && tradeSummary.cvdSlope >= 0) qualityScore -= 12;

    let qualityCap = 180;
    if (!hasGoodTradingVolume(quoteVolume)) qualityCap = Math.min(qualityCap, 110);
    if (rejectionVolumeFactor < MIN_VISIBLE_SIGNAL_VOLUME_FACTOR) qualityCap = Math.min(qualityCap, 120);
    if (!flowAligned) qualityCap = Math.min(qualityCap, 120);
    if (!touch20 && !touch50 && !useLevelTwo) qualityCap = Math.min(qualityCap, 115);
    const elite =
      flowAligned &&
      hasGoodTradingVolume(quoteVolume) &&
      rejectionVolumeFactor >= 1.2 &&
      rr >= 1.6 &&
      (useLevelTwo || touch20 || touch50);
    if (!elite) qualityCap = Math.min(qualityCap, 138);
    qualityScore = Math.min(qualityScore, qualityCap);
    if (rr < MIN_VISIBLE_SIGNAL_RR || tp2 === tp1) continue;

    const signal = {
      id: `${snapshot.symbol}:${side}:${confluenceLabel}:${touchedCandle.time}`,
      time: touchedCandle.time,
      detectedAt: touchedCandle.time * 1000,
      symbol: snapshot.symbol,
      token: snapshot.token,
      side,
      tone,
      touch: confluenceLabel,
      strength: useLevelTwo ? "Strong Signal" : "Good Signal",
      levelTag,
      testedLevel: anchorLevel,
      qualityScore: Math.max(0, Math.round(qualityScore)),
      entryLow,
      entryHigh,
      stopLoss,
      tp1,
      tp2,
      rr,
      sinceTouchBars,
      recentDistancePct,
      retestCount,
      flowConfirmations,
      wickRejected,
      emaSeparationAtr,
      higherTimeframeConfirmed,
      extensionFromTouch,
      executionDistanceFromTouch,
      volumeFactor: rejectionVolumeFactor,
      moveStopToEntryAfterTp1: true,
      note:
        side === "Long"
          ? `${confluenceLabel} held while EMA20 stays above EMA50. TP1 is R1, TP2 is R2, and the stop moves to entry after TP1.`
          : `${confluenceLabel} held while EMA50 stays above EMA20. TP1 is S1, TP2 is S2, and the stop moves to entry after TP1.`,
      reasonParts: [
        useLevelTwo ? `${levelTag} strong` : `${levelTag} good`,
        touch20 || touch50 ? `EMA confluence ${touch20 && touch50 ? "20/50" : touch50 ? "50" : "20"}` : "level-led setup",
        "EMA20 slope aligned",
        `EMA separation ${emaSeparationAtr.toFixed(2)} ATR`,
        "wick rejection confirmed",
        `flow ${flowConfirmations}/3`,
        retestCount <= 1 ? "first retest" : "second retest",
        side === "Long"
          ? higherTimeframeLongConfirmed
            ? "4H trend confirmed"
            : "4H trend mixed"
          : higherTimeframeShortConfirmed
            ? "4H trend confirmed"
            : "4H trend mixed",
        hasGoodTradingVolume(quoteVolume) ? "good liquidity" : "thin liquidity",
        rejectionVolumeFactor >= 1.15 ? "buy/sell volume confirmed" : "volume soft",
        side === "Long" ? (tradeSummary.cvdSlope > 0 ? "CVD supportive" : "CVD soft") : tradeSummary.cvdSlope < 0 ? "CVD supportive" : "CVD soft",
        side === "Long" ? (takerSummary.latestRatio > 1 ? "buyers active" : "buyers not leading") : takerSummary.latestRatio < 1 ? "sellers active" : "sellers not leading",
      ],
    };

    historicalSignals.push(signal);
    markers.push({
      time: touchedCandle.time,
      position: side === "Long" ? "belowBar" : "aboveBar",
      color: side === "Long" ? "#35c282" : "#e04c4c",
      shape: "circle",
      text: `${side === "Long" ? "L" : "S"}${useLevelTwo ? "2" : "1"}`,
    });

    if (!activeSignal && signal.sinceTouchBars <= MAX_STALE_SIGNAL_BARS) {
      activeSignal = signal;
    } else if (
      signal.sinceTouchBars <= MAX_STALE_SIGNAL_BARS &&
      signal.qualityScore > (activeSignal?.qualityScore || 0)
    ) {
      activeSignal = signal;
    }
  }

  const setupBias = activeSignal
    ? {
        label: activeSignal.side === "Long" ? "Bullish Pullback" : "Bearish Pullback",
        tone: activeSignal.tone,
        summary: activeSignal.note,
      }
    : bias;

  return {
    symbol: snapshot.symbol,
    token: snapshot.token,
    pricePrecision: snapshot.pricePrecision || 2,
    currentPrice,
    change24h: Number(snapshot.ticker?.priceChangePercent) || 0,
    latestEma20,
    latestEma50,
    latestRsi,
    latestAtr,
    latestVolume: candles[candles.length - 1]?.volume || 0,
    supportResistance,
    setupBias,
    tradeSummary,
    depthSummary,
    takerSummary,
    oiChange1h,
    fundingRate,
    ema20LineData: candles
      .map((candle, index) => (ema20Series[index] == null ? null : { time: candle.time, value: ema20Series[index] }))
      .filter(Boolean),
    ema50LineData: candles
      .map((candle, index) => (ema50Series[index] == null ? null : { time: candle.time, value: ema50Series[index] }))
      .filter(Boolean),
    markers: markers.slice(-12),
    historicalSignals: historicalSignals.slice(-10),
    activeSignal,
    qualityScore: activeSignal?.qualityScore ?? 0,
    candles,
  };
}

function buildSignalCards(analysis) {
  const active = analysis.activeSignal;
  if (!active) {
    return [
      {
        label: "Status",
        value: "No fresh setup",
        note: "The last few 1H candles did not produce a clean S1/S2 or R1/R2 reaction with volume confirmation.",
        tone: "neutral",
      },
      {
        label: "Trend stack",
        value: analysis.setupBias.label,
        note: analysis.setupBias.summary,
        tone: analysis.setupBias.tone,
      },
      {
        label: "Volume tier",
        value: volumeTier(universeTickerMap.get(analysis.symbol)?.quoteVolume || 0).label,
        note: "Liquidity still matters because weak names slip through EMAs more often.",
        tone: volumeTier(universeTickerMap.get(analysis.symbol)?.quoteVolume || 0).tone,
      },
    ];
  }

  return [
    {
      label: "Confluence",
      value: active.touch,
      note: `${active.strength} • ${active.sinceTouchBars} bars since touch`,
      tone: active.tone,
    },
    {
      label: "Momentum",
      value: active.tone === "up" ? "Buyers leading" : "Sellers leading",
      note: `${active.reasonParts[3]} • ${active.reasonParts[4]}`,
      tone: active.tone,
    },
    {
      label: "Reward to risk",
      value: `${active.rr.toFixed(2)}R`,
      note: `TP1 ${active.side === "Long" ? "R1" : "S1"} • TP2 ${active.side === "Long" ? "R2" : "S2"} • move SL to entry after TP1`,
      tone: active.rr >= 1.5 ? "up" : "neutral",
    },
  ];
}

function volumeColor(candle) {
  return candle.close >= candle.open ? "rgba(17, 187, 109, 0.4)" : "rgba(224, 76, 76, 0.38)";
}

function initChart() {
  if (chart) return;
  chart = LightweightCharts.createChart(dom.chart, {
    width: dom.chart.clientWidth,
    height: dom.chart.clientHeight,
    layout: {
      background: { color: "#040503" },
      textColor: "#a6ae9a",
      fontFamily: '"IBM Plex Sans", "Helvetica Neue", "Segoe UI", sans-serif',
    },
    grid: {
      vertLines: { color: "rgba(255, 255, 255, 0.04)" },
      horzLines: { color: "rgba(255, 255, 255, 0.06)" },
    },
    timeScale: {
      borderColor: "rgba(255, 255, 255, 0.08)",
      timeVisible: true,
    },
    rightPriceScale: {
      borderColor: "rgba(255, 255, 255, 0.08)",
    },
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: "#57da86",
    downColor: "#e25b5b",
    wickUpColor: "#57da86",
    wickDownColor: "#e25b5b",
    borderVisible: false,
  });

  ema20LineSeries = chart.addLineSeries({
    color: "#d8ff4d",
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });

  ema50LineSeries = chart.addLineSeries({
    color: "#c2cec0",
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });

  volumeSeries = chart.addHistogramSeries({
    priceFormat: { type: "volume" },
    priceScaleId: "",
    color: "rgba(216, 255, 77, 0.2)",
  });

  volumeSeries.priceScale().applyOptions({
    scaleMargins: {
      top: 0.82,
      bottom: 0,
    },
  });

  if (!chartResizeBound) {
    window.addEventListener("resize", resizeChart);
    chartResizeBound = true;
  }
}

function resetChart() {
  removePriceLines();
  hideChartSeriesLabels();

  if (chart) {
    chart.remove();
  }

  chart = null;
  candleSeries = null;
  volumeSeries = null;
  ema20LineSeries = null;
  ema50LineSeries = null;
  priceLines = [];
  dom.chart.innerHTML = "";
  initChart();
}

function resizeChart() {
  if (!chart || !dom.chart) return;
  chart.applyOptions({
    width: dom.chart.clientWidth,
    height: dom.chart.clientHeight,
  });
}

function removePriceLines() {
  if (!candleSeries) return;
  priceLines.forEach((line) => candleSeries.removePriceLine(line));
  priceLines = [];
}

function addLevelLine(price, label, color) {
  if (!Number.isFinite(price)) return;
  const line = candleSeries.createPriceLine({
    price,
    color,
    lineWidth: 2,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    axisLabelVisible: true,
    title: label,
  });
  priceLines.push(line);
}

function hideChartSeriesLabels() {
  dom.chartLineLabelEma20.hidden = true;
  dom.chartLineLabelEma50.hidden = true;
}

function renderChartSeriesLabels(ema20Value, ema50Value, anchorTime) {
  if (!chart || !ema20LineSeries || !ema50LineSeries) {
    hideChartSeriesLabels();
    return;
  }

  window.requestAnimationFrame(() => {
    const latestTime = anchorTime ?? state.chartSnapshot?.candles?.[state.chartSnapshot.candles.length - 1]?.time ?? null;
    const chartWidth = dom.chart.clientWidth;
    const xCoordinate = Number.isFinite(latestTime) ? chart.timeScale().timeToCoordinate(latestTime) : null;
    const labelX = Number.isFinite(xCoordinate)
      ? Math.max(72, Math.min(chartWidth - 148, xCoordinate - 64))
      : Math.max(72, chartWidth - 180);

    const entries = [
      { element: dom.chartLineLabelEma20, series: ema20LineSeries, value: ema20Value },
      { element: dom.chartLineLabelEma50, series: ema50LineSeries, value: ema50Value },
    ];

    const active = entries
      .map((entry) => {
        const y = Number.isFinite(entry.value) ? entry.series.priceToCoordinate(entry.value) : null;
        if (!entry.element || !Number.isFinite(y)) {
          if (entry.element) entry.element.hidden = true;
          return null;
        }
        return { ...entry, y };
      })
      .filter(Boolean)
      .sort((left, right) => left.y - right.y);

    if (!active.length) {
      hideChartSeriesLabels();
      return;
    }

    const topPadding = 18;
    const bottomPadding = 10;
    const minGap = 18;
    const chartHeight = dom.chart.clientHeight;
    const positioned = [];

    active.forEach((entry, index) => {
      let y = Math.max(topPadding, Math.min(chartHeight - bottomPadding, entry.y - 12));
      if (index > 0 && y - positioned[index - 1].y < minGap) {
        y = positioned[index - 1].y + minGap;
      }
      positioned.push({ element: entry.element, y });
    });

    for (let index = positioned.length - 2; index >= 0; index -= 1) {
      const next = positioned[index + 1];
      if (next.y > chartHeight - bottomPadding) {
        positioned[index + 1].y = chartHeight - bottomPadding;
        positioned[index].y = Math.max(topPadding, positioned[index + 1].y - minGap);
      }
    }

    positioned.forEach((entry) => {
      entry.element.hidden = false;
      entry.element.style.left = `${labelX}px`;
      entry.element.style.top = `${entry.y}px`;
    });
  });
}

function renderChartHud(analysis) {
  dom.chartEma20.textContent = formatPrice(analysis.latestEma20, analysis.pricePrecision);
  dom.chartEma50.textContent = formatPrice(analysis.latestEma50, analysis.pricePrecision);
  dom.chartRsi.textContent = Number.isFinite(analysis.latestRsi) ? analysis.latestRsi.toFixed(1) : "-";
  dom.chartVolume.textContent = formatCompactNumber(analysis.latestVolume, 2);
  dom.chartEma20.className = toneFromNumber(analysis.currentPrice - analysis.latestEma20, 0.02);
  dom.chartEma50.className = toneFromNumber(analysis.currentPrice - analysis.latestEma50, 0.02);
  dom.chartRsi.className =
    analysis.latestRsi >= 50 && analysis.latestRsi <= 70 ? "up" : analysis.latestRsi < 45 ? "down" : "neutral";
  dom.chartVolume.className = "up";
}

function renderChart(analysis, snapshot) {
  candleSeries.setData(snapshot.candles);
  volumeSeries.setData(
    snapshot.candles.map((candle) => ({
      time: candle.time,
      value: candle.volume,
      color: volumeColor(candle),
    }))
  );
  ema20LineSeries.setData(analysis.ema20LineData);
  ema50LineSeries.setData(analysis.ema50LineData);
  candleSeries.setMarkers(analysis.markers || []);
  chart.timeScale().fitContent();
  removePriceLines();

  analysis.supportResistance.supportLevels.forEach((level, index) => {
    addLevelLine(level, `S${index + 1}`, "#1db96f");
  });
  analysis.supportResistance.resistanceLevels.forEach((level, index) => {
    addLevelLine(level, `R${index + 1}`, "#db5555");
  });

  renderChartSeriesLabels(
    analysis.latestEma20,
    analysis.latestEma50,
    analysis.ema20LineData[analysis.ema20LineData.length - 1]?.time || snapshot.candles[snapshot.candles.length - 1]?.time
  );
  renderChartHud(analysis);
}

function renderSelectedAnalysis(analysis, snapshot) {
  const symbolChanged = state.selectedSymbol && state.selectedSymbol !== snapshot.symbol;
  if (symbolChanged) {
    resetChart();
  }

  state.chartAnalysis = analysis;
  state.chartSnapshot = snapshot;
  state.selectedSymbol = snapshot.symbol;
  state.selectedToken = snapshot.token;
  persistState();

  dom.tokenInput.value = snapshot.token;
  dom.assetTitle.textContent = `${snapshot.symbol} 1H Pullback`;
  dom.assetSubtitle.textContent = `EMA + S/R confluence map • ${analysis.historicalSignals.length} recent strategy markers`;
  dom.headlinePrice.textContent = formatPrice(analysis.currentPrice, analysis.pricePrecision);
  dom.headlineChange.textContent = formatPercent(analysis.change24h);
  dom.headlineChange.className = toneFromNumber(analysis.change24h, 0.08);
  dom.headlineBias.textContent = analysis.setupBias.label;
  dom.headlineBias.className = analysis.setupBias.tone;
  dom.metricSelected.textContent = snapshot.symbol;
  dom.metricSelectedNote.textContent = analysis.activeSignal
    ? `${analysis.activeSignal.touch} • ${analysis.activeSignal.strength}`
    : analysis.setupBias.summary;

  const quality = qualityTier(analysis.qualityScore);
  const active = analysis.activeSignal;
  dom.qualityBadge.textContent = `${analysis.qualityScore}`;
  dom.qualityBadge.className = analysis.activeSignal
    ? `score-badge ${analysis.setupBias.tone} ${quality.className}`
    : "score-badge neutral";
  setQualityMeter(analysis.qualityScore);
  const waitingForRetest = active ? !signalIsAtLiveEntry(active, analysis.currentPrice) : false;
  setStreamStatus(
    analysis.activeSignal
      ? waitingForRetest
        ? `${analysis.activeSignal.side} setup detected • waiting for entry zone retest`
        : `${analysis.activeSignal.side} setup live in entry zone`
      : "No fresh 1H EMA + S/R confluence signal right now",
    analysis.activeSignal ? (waitingForRetest ? "waiting" : analysis.activeSignal.tone) : "neutral"
  );

  dom.summaryCopy.textContent = active
    ? waitingForRetest
      ? `${snapshot.symbol} has a valid ${active.side.toLowerCase()} continuation setup after a ${active.touch} confluence, but price is still outside the entry zone. Quality ${active.qualityScore} reflects trend stack, level strength, candle confirmation, liquidity, order flow, and room to target while the engine waits for the retest.`
      : `${snapshot.symbol} is showing a ${active.side.toLowerCase()} continuation setup after a ${active.touch} confluence with strong volume. Quality ${active.qualityScore} reflects trend stack, level strength, candle confirmation, liquidity, order flow, and room to target.`
    : `${snapshot.symbol} still shows ${analysis.setupBias.label.toLowerCase()} structure, but the latest candles have not produced a fresh support/resistance confluence worth promoting.`;

  dom.stancePill.textContent = active ? (waitingForRetest ? "Waiting" : active.side) : "Waiting";
  dom.stancePill.className = `pill ${active ? (waitingForRetest ? "waiting" : active.tone) : "neutral"}`;
  dom.entryZone.textContent = active
    ? `${formatPrice(active.entryLow, analysis.pricePrecision)} - ${formatPrice(active.entryHigh, analysis.pricePrecision)}`
    : "-";
  dom.stop.textContent = active ? formatPrice(active.stopLoss, analysis.pricePrecision) : "-";
  dom.tp1.textContent = active ? formatPrice(active.tp1, analysis.pricePrecision) : "-";
  dom.tp2.textContent = active ? formatPrice(active.tp2, analysis.pricePrecision) : "-";
  dom.planNote.textContent = active
    ? waitingForRetest
      ? `${active.touch} • detected ${formatDateTime(active.detectedAt)} • waiting for price to retest ${formatPrice(active.entryLow, analysis.pricePrecision)} - ${formatPrice(active.entryHigh, analysis.pricePrecision)}`
      : `${active.touch} • detected ${formatDateTime(active.detectedAt)} • ${active.sinceTouchBars} bars since touch`
    : "Need a fresh EMA + S1/S2 or R1/R2 confluence with confirmation";
  dom.tradeSummary.textContent = active
    ? waitingForRetest
      ? `${active.note} The setup is valid, but no entry should be taken until price actually returns into the entry zone. Initial invalidation still sits beyond the touched support or resistance plus an ATR buffer.`
      : `${active.note} Entry zone centers on the reaction into the tested level and nearby EMA confluence. Initial invalidation sits beyond the touched support or resistance plus an ATR buffer.`
    : "Tradez is waiting for a fresh trend pullback that reacts at S1/S2 or R1/R2, ideally with EMA confluence and strong volume.";

  renderSignalList(buildSignalCards(analysis));
  renderLevelBands(
    dom.supportFields,
    analysis.supportResistance.supportLevels,
    analysis.supportResistance.bandWidth,
    "up",
    analysis.pricePrecision
  );
  renderLevelBands(
    dom.resistanceFields,
    analysis.supportResistance.resistanceLevels,
    analysis.supportResistance.bandWidth,
    "down",
    analysis.pricePrecision
  );
  renderChart(analysis, snapshot);
}

function renderEmptySelected(message) {
  dom.assetTitle.textContent = "Tradez chart";
  dom.assetSubtitle.textContent = message;
  dom.headlinePrice.textContent = "-";
  dom.headlineChange.textContent = "-";
  dom.headlineBias.textContent = "-";
  dom.qualityBadge.textContent = "0";
  dom.qualityBadge.className = "score-badge neutral";
  setQualityMeter(0);
  dom.summaryCopy.textContent = message;
  dom.stancePill.textContent = "Waiting";
  dom.stancePill.className = "pill neutral";
  dom.entryZone.textContent = "-";
  dom.stop.textContent = "-";
  dom.tp1.textContent = "-";
  dom.tp2.textContent = "-";
  dom.tradeSummary.textContent = "No Tradez setup yet.";
  renderSignalList([
    {
      label: "Status",
      value: "Waiting",
      note: message,
      tone: "neutral",
    },
  ]);
  renderLevelBands(dom.supportFields, [], 0, "neutral", 2);
  renderLevelBands(dom.resistanceFields, [], 0, "neutral", 2);
  candleSeries.setData([]);
  volumeSeries.setData([]);
  ema20LineSeries.setData([]);
  ema50LineSeries.setData([]);
  candleSeries.setMarkers([]);
  removePriceLines();
  hideChartSeriesLabels();
  dom.chartEma20.textContent = "-";
  dom.chartEma50.textContent = "-";
  dom.chartRsi.textContent = "-";
  dom.chartVolume.textContent = "-";
}

function renderMonitorTable(container, headers, rows, emptyText) {
  if (!rows.length) {
    container.innerHTML = `
      <div class="monitor-empty">
        ${emptyText}
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="monitor-table-shell">
      <table>
        <thead>
          <tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows.join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderSignalFeed() {
  const qualified = state.candidates
    .filter((candidate) => candidate.activeSignal && candidate.qualityScore >= state.qualityThreshold)
    .sort((left, right) => {
      const rightSeen = right.identifiedAt || right.activeSignal?.detectedAt || 0;
      const leftSeen = left.identifiedAt || left.activeSignal?.detectedAt || 0;
      return rightSeen - leftSeen || right.qualityScore - left.qualityScore;
    });

  if (!qualified.length) {
    state.selectedFeedSymbol = null;
    dom.signalTable.innerHTML = `
      <div class="monitor-empty">
        No EMA20/50 pullback setup currently clears the active quality threshold.
      </div>
    `;
    return;
  }

  const selectedCandidate =
    qualified.find((candidate) => candidate.symbol === state.selectedFeedSymbol) || qualified[0];
  const selectedSignal = selectedCandidate.activeSignal;
  const seenAt = selectedCandidate.identifiedAt || selectedSignal.detectedAt;
  const isNew = isFreshSignal(seenAt);
  const waitingForRetest = !signalIsAtLiveEntry(selectedSignal, selectedCandidate.currentPrice);
  const sideClass = selectedSignal.side === "Long" ? "is-long" : "is-short";
  const quality = qualityTier(selectedCandidate.qualityScore);
  state.selectedFeedSymbol = selectedCandidate.symbol;
  persistState();

  dom.signalTable.innerHTML = `
    <div class="tradez-feed-board">
      <div class="tradez-feed-token-tabs" role="tablist" aria-label="Qualified Tradez pairs">
        ${qualified
          .map((candidate) => {
            const signal = candidate.activeSignal;
            const candidateSeenAt = candidate.identifiedAt || signal.detectedAt;
            const candidateIsNew = isFreshSignal(candidateSeenAt);
            const isSelected = candidate.symbol === selectedCandidate.symbol;
            return `
              <button
                class="mini-button tradez-symbol-button ${isSelected ? "is-active" : ""}"
                type="button"
                role="tab"
                aria-selected="${isSelected ? "true" : "false"}"
                data-feed-symbol="${candidate.symbol}"
              >
                <span>${candidate.symbol}</span>
                ${candidateIsNew ? '<em class="tradez-feed-tab-new">NEW</em>' : ""}
              </button>
            `;
          })
          .join("")}
      </div>

      <article class="tradez-feed-card ${sideClass}">
        <div class="tradez-feed-card-head">
          <div class="tradez-feed-symbol-block">
            <div class="tradez-feed-symbol-row">
              <button class="mini-button tradez-symbol-button tradez-symbol-button-open" type="button" data-symbol="${selectedCandidate.symbol}">
                ${selectedCandidate.symbol}
              </button>
              <div class="monitor-subtle">${volumeTier(universeTickerMap.get(selectedCandidate.symbol)?.quoteVolume || 0).label}</div>
            </div>
          </div>
          <div class="tradez-feed-stamp-block">
            ${isNew ? '<span class="tradez-feed-new">NEW</span>' : ""}
            <time datetime="${new Date(seenAt).toISOString()}">${formatExactDateTime(seenAt)}</time>
          </div>
        </div>

        <div class="tradez-feed-summary-row">
          <div class="tradez-feed-meta-item">
            <span>Setup</span>
            <strong class="${selectedSignal.tone}">${selectedSignal.side}</strong>
          </div>
          <div class="tradez-feed-quality-center">
            <span class="tradez-feed-quality-caption">Quality Score</span>
            <div class="tradez-feed-quality-badge ${sideClass}">
              Q${selectedCandidate.qualityScore}
            </div>
            <span class="tradez-feed-quality-tier">${quality.label}</span>
          </div>
          <div class="tradez-feed-meta-item tradez-feed-meta-item-right">
            <span>Touch</span>
            <strong>${selectedSignal.touch}</strong>
          </div>
        </div>

        <div class="tradez-feed-entry-state ${waitingForRetest ? "waiting" : selectedSignal.tone}">
          ${waitingForRetest
            ? `Waiting for entry zone retest • live price ${formatPrice(selectedCandidate.currentPrice, selectedCandidate.pricePrecision)} is still outside ${formatPrice(selectedSignal.entryLow, selectedCandidate.pricePrecision)} - ${formatPrice(selectedSignal.entryHigh, selectedCandidate.pricePrecision)}`
            : `Live entry now • price ${formatPrice(selectedCandidate.currentPrice, selectedCandidate.pricePrecision)} is inside the planned entry zone`}
        </div>

        <div class="tradez-feed-plan-grid">
          <div class="tradez-feed-plan-item">
            <span>Price</span>
            <strong>${formatPrice(selectedCandidate.currentPrice, selectedCandidate.pricePrecision)}</strong>
          </div>
          <div class="tradez-feed-plan-item">
            <span>Entry</span>
            <strong>${formatPrice(selectedSignal.entryLow, selectedCandidate.pricePrecision)} - ${formatPrice(selectedSignal.entryHigh, selectedCandidate.pricePrecision)}</strong>
          </div>
          <div class="tradez-feed-plan-item">
            <span>Stop</span>
            <strong>${formatPrice(selectedSignal.stopLoss, selectedCandidate.pricePrecision)}</strong>
          </div>
          <div class="tradez-feed-plan-item">
            <span>Targets</span>
            <strong>${formatPrice(selectedSignal.tp1, selectedCandidate.pricePrecision)} / ${formatPrice(selectedSignal.tp2, selectedCandidate.pricePrecision)}</strong>
          </div>
        </div>

        <div class="tradez-feed-qualifiers">${selectedSignal.reasonParts.slice(0, 4).join(" • ")}</div>
      </article>
    </div>
  `;

  dom.signalTable.querySelectorAll("[data-feed-symbol]").forEach((button) => {
    button.addEventListener("click", () => {
      const symbol = button.getAttribute("data-feed-symbol");
      if (!symbol) return;
      state.selectedFeedSymbol = symbol;
      persistState();
      renderSignalFeed();
    });
  });

  dom.signalTable.querySelectorAll("[data-symbol]").forEach((button) => {
    button.addEventListener("click", async () => {
      const symbol = button.getAttribute("data-symbol");
      if (!symbol) return;
      await loadSelectedToken(symbol);
    });
  });
}

function renderAlertFeed() {
  if (!state.alertEvents.length) {
    dom.alertTable.innerHTML = `
      <div class="table-row">
        <div>
          <span>Status</span>
          <strong>No alerts yet</strong>
        </div>
        <div>
          <span>Trigger</span>
          <strong>Waiting</strong>
        </div>
        <div>
          <span>Note</span>
          <strong>Tradez will log new qualified EMA pullbacks here.</strong>
        </div>
      </div>
    `;
    return;
  }

  dom.alertTable.innerHTML = state.alertEvents
    .slice()
    .sort((left, right) => (right.identifiedAt || right.detectedAt || 0) - (left.identifiedAt || left.detectedAt || 0))
    .slice(0, 16)
    .map(
      (event) => `
        <div class="table-row">
          <div>
            <span>${formatExactDateTime(event.identifiedAt || event.detectedAt)}</span>
            <strong class="${event.tone}">${event.symbol} • ${event.side} • Q${event.qualityScore}</strong>
          </div>
          <div>
            <span>Touch</span>
            <strong>${event.touch}</strong>
          </div>
          <div>
            <span>Plan</span>
            <strong>${event.plan}</strong>
          </div>
        </div>
      `
    )
    .join("");
}

function renderStrategyNotes() {
  renderAnalysisGrid(dom.notesGrid, [
    {
      label: "What qualifies",
      value: "Trend + level + volume",
      note: "Longs need EMA20 above EMA50 with a reaction at S1 or S2, plus strong buying volume. Shorts need EMA50 above EMA20 with a reaction at R1 or R2, plus strong selling volume.",
      tone: "up",
    },
    {
      label: "Best upgrade",
      value: "EMA + S/R confluence",
      note: "A plain S1/R1 touch is valid, but quality improves when the candle also tags EMA20 or EMA50 at the same time. S2 and R2 are treated as the stronger version of the setup.",
      tone: "neutral",
    },
    {
      label: "Trade plan",
      value: "TP1 level, TP2 extension",
      note: "For longs, TP1 is R1 and TP2 is R2. For shorts, TP1 is S1 and TP2 is S2. After TP1, the stop should move to entry so the second leg is protected.",
      tone: "up",
    },
    {
      label: "Avoid",
      value: "Weak volume or cramped room",
      note: "If volume does not confirm, or the next target level is too close to justify the risk, the setup should stay on watch instead of being promoted.",
      tone: "down",
    },
  ]);
}

function updateTabs() {
  const tabs = [
    { key: "signals", button: dom.tabSignals, panel: dom.panelSignals, note: "Signal Feed shows the highest-quality live EMA pullback opportunities across the scanned universe." },
    { key: "alerts", button: dom.tabAlerts, panel: dom.panelAlerts, note: "Alert Events logs newly detected qualifying setups as the engine rotates through the universe." },
    { key: "notes", button: dom.tabNotes, panel: dom.panelNotes, note: "Strategy Notes keeps the pattern disciplined so we do not treat every EMA touch as an entry." },
  ];

  tabs.forEach((tab) => {
    tab.button.classList.toggle("is-active", state.activeTab === tab.key);
    tab.panel.hidden = state.activeTab !== tab.key;
    if (state.activeTab === tab.key) dom.tabNote.textContent = tab.note;
  });
}

function updateWorkspaceMode() {
  if (!dom.workspaceTabLive || !dom.workspacePanelLive || !dom.workspacePanelCompare) return;

  const isLiveMode = state.workspaceMode !== "compare";
  dom.workspaceTabLive.classList.toggle("is-active", isLiveMode);
  dom.workspaceTabCompare.classList.toggle("is-active", !isLiveMode);
  dom.workspacePanelLive.hidden = !isLiveMode;
  dom.workspacePanelCompare.hidden = isLiveMode;

  if (dom.workspaceNote) {
    dom.workspaceNote.textContent = isLiveMode
      ? "Live Desk keeps the signal stream front and center while the heavier benchmarking workspace stays tucked away until needed."
      : "System Compare brings the benchmark cards, Auto Trade 2 controls, and execution workspace forward when you want to review system performance.";
  }
}

function pushAlertEvent(candidate) {
  const signal = candidate.activeSignal;
  if (!signal || signal.qualityScore < state.qualityThreshold) return;
  if (state.seenSignalIds.has(signal.id)) return;

  state.seenSignalIds.add(signal.id);
  const identifiedAt = candidate.identifiedAt || Date.now();
  state.alertEvents.unshift({
    id: signal.id,
    identifiedAt,
    detectedAt: signal.detectedAt,
    symbol: candidate.symbol,
    side: signal.side,
    tone: signal.tone,
    touch: signal.touch,
    qualityScore: signal.qualityScore,
    plan: `${formatPrice(signal.entryLow, candidate.pricePrecision)} - ${formatPrice(signal.entryHigh, candidate.pricePrecision)} • TP ${formatPrice(signal.tp1, candidate.pricePrecision)}`,
  });
  state.alertEvents = state.alertEvents.slice(0, 36);
  persistState();
  renderAlertFeed();

  if (state.alertPermission === "granted" && typeof Notification !== "undefined") {
    const notification = new Notification(`${candidate.symbol} ${signal.side} pullback`, {
      body: `${signal.touch} retest qualified at Q${signal.qualityScore}. Entry ${formatPrice(signal.entryLow, candidate.pricePrecision)} - ${formatPrice(signal.entryHigh, candidate.pricePrecision)}.`,
    });
    window.setTimeout(() => notification.close(), 7000);
  }
}

function updateMetrics() {
  const qualified = state.candidates.filter((candidate) => candidate.activeSignal && candidate.qualityScore >= state.qualityThreshold);
  const bullish = qualified.filter((candidate) => candidate.activeSignal.side === "Long").length;
  const bearish = qualified.filter((candidate) => candidate.activeSignal.side === "Short").length;

  dom.metricQualified.textContent = `${qualified.length}`;
  dom.metricQualifiedNote.textContent = `Quality >= ${state.qualityThreshold} on 1H pullbacks`;
  dom.metricBullish.textContent = `${bullish}`;
  dom.metricBullishNote.textContent = bullish ? "Long EMA pullbacks active" : "No long pullbacks qualified";
  dom.metricBearish.textContent = `${bearish}`;
  dom.metricBearishNote.textContent = bearish ? "Short EMA pullbacks active" : "No short pullbacks qualified";
  dom.metricAlerts.textContent = `${state.alertEvents.length}`;
  dom.metricAlertsNote.textContent = state.alertEvents.length ? "Stored alert events on this browser" : "No alert events stored yet";
  dom.metricLastScan.textContent = formatClock(state.lastScanAt);
  dom.metricLastScanNote.textContent = state.lastScanAt
    ? remoteRuntimeEnabled
      ? "Universe rotated every 5m on the background runtime"
      : "Universe rotated every 5m"
    : "First scan pending";
  dom.autoNote.textContent = remoteRuntimeEnabled
    ? `Universe scan refreshes every 5 minutes on the background runtime. ${qualified.length} qualified right now.`
    : `Universe scan refreshes every 5 minutes. ${qualified.length} qualified right now.`;
}

function updateAlertPermissionButton() {
  const status = state.alertPermission;
  if (status === "granted") dom.alertPermissionButton.textContent = "Browser Alerts Enabled";
  else if (status === "denied") dom.alertPermissionButton.textContent = "Browser Alerts Blocked";
  else if (status === "unsupported") dom.alertPermissionButton.textContent = "Alerts Unsupported";
  else dom.alertPermissionButton.textContent = "Enable Browser Alerts";
  dom.alertPermissionButton.disabled = status === "unsupported" || status === "denied";
}

async function requestAlertPermission() {
  if (typeof Notification === "undefined") {
    state.alertPermission = "unsupported";
    updateAlertPermissionButton();
    return;
  }
  state.alertPermission = await Notification.requestPermission();
  tradezDelivery.browser = state.alertPermission === "granted" ? tradezDelivery.browser : false;
  persistTradezDeliveryState();
  syncTradezDeliveryInputs();
  refreshTradezDeliverySummary();
  updateAlertPermissionButton();
}

function saveTradezDeliveryFromForm() {
  if (!dom.deliveryForm) return;
  tradezDelivery.mode = "demo";
  tradezDelivery.browser = Boolean(dom.alertBrowserEnabled?.checked);
  tradezDelivery.discordWebhook = String(dom.alertDiscordWebhook?.value || "").trim();
  tradezDelivery.telegramToken = String(dom.alertTelegramToken?.value || "").trim();
  tradezDelivery.telegramChatId = String(dom.alertTelegramChatId?.value || "").trim();
  tradezDelivery.notifyEntries = Boolean(dom.auto2NotifyEntries?.checked);
  tradezDelivery.notifyExits = Boolean(dom.auto2NotifyExits?.checked);
  tradezDelivery.template = String(dom.alertTemplate?.value || "").trim() || DEFAULT_TRADEZ_SIGNAL_TEMPLATE;
  persistTradezDeliveryState();
  refreshTradezDeliverySummary();
  renderTradezPaperDashboard();

  if (tradezDelivery.browser && typeof Notification !== "undefined" && Notification.permission === "default") {
    Notification.requestPermission()
      .then((permission) => {
        state.alertPermission = permission;
        updateAlertPermissionButton();
      })
      .catch(() => {});
  }
}

async function loadSelectedToken(tokenOrSymbol) {
  const normalized = normalizeToken(tokenOrSymbol);
  setStatus(`Loading ${normalized} into Tradez...`, "neutral");

  try {
    const snapshot = await fetchEngineSnapshot(tokenOrSymbol);
    const analysis = buildTradezSignals(snapshot, universeTickerMap.get(snapshot.symbol)?.quoteVolume || Number(snapshot.ticker?.quoteVolume) || 0);
    renderSelectedAnalysis(analysis, snapshot);
    setStatus(`${snapshot.symbol} loaded into Tradez.`, "up");
  } catch (error) {
    console.error(error);
    renderEmptySelected(error.message || "Unable to load the selected Tradez chart.");
    setStatus(error.message || "Tradez chart failed to load.", "down");
  }
}

async function scanUniverse(manual = false) {
  if (remoteRuntimeEnabled) {
    if (!manual) return;
    setStatus("Running manual Tradez background scan...", "neutral");
    try {
      const payload = await postRemoteRuntimeAction("scan", {
        qualityThreshold: state.qualityThreshold,
        autoEnabled: tradezPaper.autoEnabled,
      });
      applyRemoteRuntimeState(payload.state || {});
      renderTradezRuntimeState();
      setStatus(
        payload.state?.lastStatusMessage || "Tradez background scan complete.",
        payload.state?.lastStatusTone || "neutral"
      );
    } catch (error) {
      setStatus(error.message || "Tradez background scan failed.", "down");
    }
    return;
  }

  setStatus(
    manual
      ? "Running manual Tradez universe scan..."
      : "Scanning Binance perps for 1H EMA20/50 pullback setups...",
    "neutral"
  );

  try {
    const universe = await getPerpUniverse();
    const tickers = await fetchUniverseTickers();
    universeTickerMap = buildTickerLookup(tickers);
    const batch = selectUniverseBatch(universe);

    const analyses = await mapWithConcurrency(batch, ANALYSIS_CONCURRENCY, async (symbolInfo) => {
      try {
        const snapshot = await fetchEngineSnapshot(symbolInfo.symbol);
        const ticker = universeTickerMap.get(symbolInfo.symbol) || {};
        const analysis = buildTradezSignals(snapshot, ticker.quoteVolume || Number(snapshot.ticker?.quoteVolume) || 0);
        return {
          ...analysis,
          snapshot,
        };
      } catch (error) {
        return null;
      }
    });

    const scanIdentifiedAt = Date.now();
    const priorSignalTimes = new Map(
      state.alertEvents.map((event) => [event.id, event.identifiedAt || event.detectedAt])
    );

    analyses.forEach((candidate) => {
      if (!candidate?.activeSignal) return;
      const previous = candidateMap.get(candidate.symbol);
      const preservedIdentifiedAt =
        previous?.activeSignal?.id === candidate.activeSignal.id
          ? previous.identifiedAt
          : priorSignalTimes.get(candidate.activeSignal.id);
      candidate.identifiedAt = preservedIdentifiedAt || scanIdentifiedAt;
    });

    const analyzedCandidates = analyses.filter(Boolean);
    latestBatchMap = new Map(analyzedCandidates.map((candidate) => [candidate.symbol, candidate]));

    state.candidates = analyzedCandidates
      .filter((candidate) => candidate.activeSignal && candidate.activeSignal.sinceTouchBars <= MAX_STALE_SIGNAL_BARS)
      .sort((left, right) => right.qualityScore - left.qualityScore)
      .slice(0, 28);

    candidateMap = new Map(analyzedCandidates.map((candidate) => [candidate.symbol, candidate]));
    state.lastScanAt = Date.now();
    tradezPaper.lastScanAt = state.lastScanAt;
    persistState();

    state.candidates.forEach(pushAlertEvent);
    await syncTradezDemoStatuses(analyzedCandidates);
    refreshTradezPaperTrades(analyzedCandidates);
    const openedTrades = tradezPaper.autoEnabled ? openTradezQualifiedTrades(state.candidates) : [];
    maybeSendTradezDailyBriefing();
    renderSignalFeed();
    renderAlertFeed();
    updateMetrics();
    persistTradezPaperState();
    renderTradezPaperDashboard();

    const best = state.candidates[0];
    if (openedTrades.length) {
      const lead = openedTrades[0];
      setStatus(
        `Opened ${openedTrades.length} new EMA Signals trade${openedTrades.length > 1 ? "s" : ""}. ${tradezPaper.openTrades.length}/${TRADEZ_AUTO_MAX_CONCURRENT_TRADES} Auto Trade 2 positions are active, led by ${lead.symbol}.`,
        lead.activeSignal?.tone || "up"
      );
    } else if (best) {
      setStatus(
        `${state.candidates.filter((candidate) => candidate.qualityScore >= state.qualityThreshold).length} Tradez setups qualified. ${best.symbol} leads with Q${best.qualityScore}.`,
        "up"
      );
    } else {
      setStatus("Tradez scan complete. No setup currently clears the active quality filter.", "neutral");
    }

    const selectedCandidate = state.selectedSymbol ? latestBatchMap.get(state.selectedSymbol) : null;
    if (selectedCandidate) {
      renderSelectedAnalysis(selectedCandidate, selectedCandidate.snapshot);
    } else if (!state.chartSnapshot && best) {
      renderSelectedAnalysis(best, best.snapshot);
    } else if (!state.chartSnapshot) {
      await loadSelectedToken(state.selectedToken);
    }
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Tradez scan failed.", "down");
    if (!state.chartSnapshot) renderEmptySelected(error.message || "Tradez is waiting for data.");
    renderTradezPaperDashboard();
  }
}

function startAutoScan() {
  if (remoteRuntimeEnabled) return;
  if (scanTimer) window.clearInterval(scanTimer);
  scanTimer = window.setInterval(() => {
    scanUniverse(false);
  }, AUTO_SCAN_MS);
}

function bindEvents() {
  dom.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.selectedToken = normalizeToken(dom.tokenInput.value);
    state.qualityThreshold = Math.max(50, Number(dom.qualityThreshold.value) || DEFAULT_QUALITY_THRESHOLD);
    persistState();
    await loadSelectedToken(state.selectedToken);
    await scanUniverse(true);
  });

  dom.scanButton.addEventListener("click", async () => {
    state.qualityThreshold = Math.max(50, Number(dom.qualityThreshold.value) || DEFAULT_QUALITY_THRESHOLD);
    persistState();
    await scanUniverse(true);
  });

  dom.alertPermissionButton.addEventListener("click", requestAlertPermission);
  if (dom.deliveryForm) {
    dom.deliveryForm.addEventListener("submit", (event) => {
      event.preventDefault();
      saveTradezDeliveryFromForm();
      setStatus(`Auto Trade 2 delivery saved. ${tradezModeLabel()} is ready.`, "up");
    });
  }
  if (dom.alertTestButton) {
    dom.alertTestButton.addEventListener("click", () => {
      sendTradezTestSignal();
    });
  }
  if (dom.backupExportButton) {
    dom.backupExportButton.addEventListener("click", () => {
      downloadJsonFile(buildPaperBackupPayload(), paperBackupFilename());
      setStatus("Paper-trade backup exported.", "up");
    });
  }

  if (dom.reportExportButton) {
    dom.reportExportButton.addEventListener("click", () => {
      downloadTextFile(buildTradez24hReport(), tradezReportFilename());
      setStatus("24H EMA report exported.", "up");
    });
  }

  if (dom.backupImportButton && dom.backupFileInput) {
    dom.backupImportButton.addEventListener("click", () => {
      dom.backupFileInput.click();
    });

    dom.backupFileInput.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      try {
        await importPaperBackup(file);
      } catch (error) {
        setStatus(error.message || "Backup import failed.", "down");
      } finally {
        event.target.value = "";
      }
    });
  }

  dom.tabSignals.addEventListener("click", () => {
    state.activeTab = "signals";
    persistState();
    updateTabs();
  });
  dom.tabAlerts.addEventListener("click", () => {
    state.activeTab = "alerts";
    persistState();
    updateTabs();
  });
  dom.tabNotes.addEventListener("click", () => {
    state.activeTab = "notes";
    persistState();
    updateTabs();
  });

  if (dom.workspaceTabLive) {
    dom.workspaceTabLive.addEventListener("click", () => {
      state.workspaceMode = "live";
      persistState();
      updateWorkspaceMode();
    });
  }

  if (dom.workspaceTabCompare) {
    dom.workspaceTabCompare.addEventListener("click", () => {
      state.workspaceMode = "compare";
      persistState();
      updateWorkspaceMode();
    });
  }

  if (dom.auto2Toggle) {
    dom.auto2Toggle.addEventListener("click", async () => {
      tradezPaper.autoEnabled = !tradezPaper.autoEnabled;
      if (remoteRuntimeEnabled) {
        try {
          const payload = await postRemoteRuntimeAction("settings", {
            autoEnabled: tradezPaper.autoEnabled,
            qualityThreshold: state.qualityThreshold,
          });
          applyRemoteRuntimeState(payload.state || {});
        } catch (error) {
          tradezPaper.autoEnabled = !tradezPaper.autoEnabled;
          setStatus(error.message || "Unable to update Auto Trade 2.", "down");
          return;
        }
      }
      persistTradezPaperState();
      renderTradezPaperDashboard();
      setStatus(
        tradezPaper.autoEnabled ? "Auto Trade 2 resumed." : "Auto Trade 2 paused.",
        tradezPaper.autoEnabled ? "up" : "neutral"
      );
    });
  }

  if (dom.auto2Reset) {
    dom.auto2Reset.addEventListener("click", async () => {
      if (remoteRuntimeEnabled) {
        try {
          const payload = await postRemoteRuntimeAction("reset");
          applyRemoteRuntimeState(payload.state || {});
          renderTradezRuntimeState();
          setStatus("Auto Trade 2 reset to the $1,000 EMA research book.", "neutral");
        } catch (error) {
          setStatus(error.message || "Unable to reset Auto Trade 2.", "down");
        }
        return;
      }
      tradezPaper.balance = TRADEZ_AUTO_START_BALANCE;
      tradezPaper.startingBalance = TRADEZ_AUTO_START_BALANCE;
      tradezPaper.openTrades = [];
      tradezPaper.closedTrades = [];
      tradezPaper.demoOrders = [];
      tradezPaper.activity = [];
      tradezPaper.lastScanAt = 0;
      tradezPaper.lastDailyBriefingUtcDate = utcDayKey(Date.now() - UTC_DAY_MS);
      logTradezPaperActivity("Auto Trade 2 reset to the $1,000 EMA research book.", "neutral");
      persistTradezPaperState();
      renderTradezPaperDashboard();
      setStatus("Auto Trade 2 reset to the $1,000 EMA research book.", "neutral");
    });
  }

  if (dom.auto2TabPositions) {
    dom.auto2TabPositions.addEventListener("click", () => {
      tradezPaper.activeTab = "positions";
      persistTradezPaperState();
      renderTradezAutoTabs();
    });
  }

  if (dom.auto2TabTrades) {
    dom.auto2TabTrades.addEventListener("click", () => {
      tradezPaper.activeTab = "trades";
      persistTradezPaperState();
      renderTradezAutoTabs();
    });
  }

  if (dom.auto2TabDemo) {
    dom.auto2TabDemo.addEventListener("click", () => {
      tradezPaper.activeTab = "demo";
      persistTradezPaperState();
      renderTradezAutoTabs();
    });
  }

  if (dom.auto2TabActivity) {
    dom.auto2TabActivity.addEventListener("click", () => {
      tradezPaper.activeTab = "activity";
      persistTradezPaperState();
      renderTradezAutoTabs();
    });
  }
}

async function init() {
  dom.tokenInput.value = state.selectedToken;
  dom.qualityThreshold.value = `${state.qualityThreshold}`;
  applyTradezPaperUpgradeNotice();
  syncTradezDeliveryInputs();
  refreshTradezDeliverySummary();
  updateAlertPermissionButton();
  updateWorkspaceMode();
  updateTabs();
  renderStrategyNotes();
  renderAlertFeed();
  renderTradezPaperDashboard();
  initChart();
  bindEvents();
  updateMetrics();
  await refreshRemoteDisplayData();
  await loadSelectedToken(state.selectedToken);
}

async function bootstrapTradezRuntime() {
  await init();

  try {
    const payload = await fetchRemoteRuntimeState();
    if (payload.backgroundAvailable) {
      remoteRuntimeEnabled = true;
      applyRemoteRuntimeState(payload.state || {});
      renderTradezRuntimeState();
      if (payload.state?.lastStatusMessage) {
        setStatus(payload.state.lastStatusMessage, payload.state.lastStatusTone || "neutral");
      } else {
        setStatus("Background Auto Trade 2 engine connected.", "up");
      }
      startRemoteRuntimePolling();
      return;
    }
  } catch (error) {
    // Fall back to the legacy in-browser scanner when the server runtime is unavailable.
  }

  remoteRuntimeEnabled = false;
  stopRemoteRuntimePolling();
  await scanUniverse(false);
  startAutoScan();
}

bootstrapTradezRuntime();
