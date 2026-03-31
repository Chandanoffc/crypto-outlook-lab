const PLAYGROUND_STORAGE_KEY = "soloris-perps-alerts-v1";
const PERPS_SCAN_INTERVAL_OPTIONS = [
  { label: "1 minute",  value: 60_000       },
  { label: "3 minutes", value: 3 * 60_000   },
  { label: "5 minutes", value: 5 * 60_000   },
  { label: "10 minutes",value: 10 * 60_000  },
  { label: "15 minutes",value: 15 * 60_000  },
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
const METEORA_BASE_URL = "https://dlmm.datapi.meteora.ag";

const PLAYGROUND_FALLBACK_UNIVERSE = [
  { symbol: "BTCUSDT",  quoteVolume: 5_000_000_000 },
  { symbol: "ETHUSDT",  quoteVolume: 2_000_000_000 },
  { symbol: "SOLUSDT",  quoteVolume: 1_200_000_000 },
  { symbol: "BNBUSDT",  quoteVolume: 800_000_000  },
  { symbol: "XRPUSDT",  quoteVolume: 600_000_000  },
  { symbol: "DOGEUSDT", quoteVolume: 500_000_000  },
  { symbol: "AVAXUSDT", quoteVolume: 350_000_000  },
  { symbol: "ADAUSDT",  quoteVolume: 280_000_000  },
  { symbol: "LINKUSDT", quoteVolume: 220_000_000  },
  { symbol: "SUIUSDT",  quoteVolume: 190_000_000  },
  { symbol: "DOTUSDT",  quoteVolume: 160_000_000  },
  { symbol: "LTCUSDT",  quoteVolume: 140_000_000  },
  { symbol: "NEARUSDT", quoteVolume: 130_000_000  },
  { symbol: "APTUSDT",  quoteVolume: 120_000_000  },
  { symbol: "OPUSDT",   quoteVolume: 110_000_000  },
];

const state = loadState();
let perpsTimer = null;
let perpsInFlight = false;

function defaultModuleWebhookHealth() {
  return {
    status: "idle",
    message: "Not tested yet",
    lastResultAt: 0,
  };
}

function loadState() {
  const fallback = {
    backgroundAvailable: false,
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
      playgroundSignals: [],
      recentCalls: [],
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
      backgroundAvailable: Boolean(stored.backgroundAvailable),
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
        playgroundSignals: Array.isArray(stored.perps?.playgroundSignals)
          ? stored.perps.playgroundSignals.slice(0, 24)
          : [],
        recentCalls: Array.isArray(stored.perps?.recentCalls) ? stored.perps.recentCalls.slice(0, 160) : [],
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
    backgroundAvailable: Boolean(state.backgroundAvailable),
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
      playgroundSignals: state.perps.playgroundSignals.slice(0, 24),
      recentCalls: state.perps.recentCalls.slice(0, 160),
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

function formatBannerPair(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";
  if (raw.includes("/")) return raw;
  if (raw.endsWith("USDT")) return `${raw.slice(0, -4)}/USDT`;
  if (raw.endsWith("USDC")) return `${raw.slice(0, -4)}/USDC`;
  return raw;
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
  if (pool.fees10m > 0) monitors.push(`Fees 10M ${pool.fees10m.toFixed(0)}`);
  if (pool.fees30m > 0) monitors.push(`Fees 30M ${pool.fees30m.toFixed(0)}`);
  if (pool.fees1h > 0) monitors.push(`Fees 1H ${pool.fees1h.toFixed(0)}`);
  if (pool.fees24h > 0) monitors.push(`Fees 24H ${pool.fees24h.toFixed(0)}`);
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

function mergePlaygroundRuntimeState(payload) {
  const remoteState = payload?.state;
  if (!remoteState) return;
  state.backgroundAvailable = Boolean(payload.backgroundAvailable);

  if (remoteState.perps) {
    state.perps.scannerEnabled = remoteState.perps.scannerEnabled !== false;
    state.perps.scanIntervalMs = Number(remoteState.perps.scanIntervalMs) || state.perps.scanIntervalMs;
    state.perps.webhook = String(remoteState.perps.webhook || state.perps.webhook || "").trim();
    state.perps.webhookHealth = remoteState.perps.webhookHealth || state.perps.webhookHealth;
    state.perps.scanLog = Array.isArray(remoteState.perps.scanLog) ? remoteState.perps.scanLog.slice(0, MAX_LOG_ENTRIES) : state.perps.scanLog;
    state.perps.alertLog = Array.isArray(remoteState.perps.alertLog) ? remoteState.perps.alertLog.slice(0, MAX_LOG_ENTRIES) : state.perps.alertLog;
    state.perps.sentIds = Array.isArray(remoteState.perps.sentIds) ? remoteState.perps.sentIds.slice(0, MAX_ALERT_IDS) : state.perps.sentIds;
    state.perps.lastSyncAt = Number(remoteState.perps.lastSyncAt) || state.perps.lastSyncAt;
    state.perps.lastError = remoteState.perps.lastError || "";
  }

  if (remoteState.dlmm) {
    state.dlmm.scannerEnabled = remoteState.dlmm.scannerEnabled !== false;
    state.dlmm.scanIntervalMs = Number(remoteState.dlmm.scanIntervalMs) || state.dlmm.scanIntervalMs;
    state.dlmm.webhook = String(remoteState.dlmm.webhook || state.dlmm.webhook || "").trim();
    state.dlmm.webhookHealth = remoteState.dlmm.webhookHealth || state.dlmm.webhookHealth;
    state.dlmm.recentCalls = Array.isArray(remoteState.dlmm.recentCalls) ? remoteState.dlmm.recentCalls.slice(0, 160) : state.dlmm.recentCalls;
    state.dlmm.scanLog = Array.isArray(remoteState.dlmm.scanLog) ? remoteState.dlmm.scanLog.slice(0, MAX_LOG_ENTRIES) : state.dlmm.scanLog;
    state.dlmm.alertLog = Array.isArray(remoteState.dlmm.alertLog) ? remoteState.dlmm.alertLog.slice(0, MAX_LOG_ENTRIES) : state.dlmm.alertLog;
    state.dlmm.sentIds = Array.isArray(remoteState.dlmm.sentIds) ? remoteState.dlmm.sentIds.slice(0, MAX_ALERT_IDS) : state.dlmm.sentIds;
    state.dlmm.lastSyncAt = Number(remoteState.dlmm.lastSyncAt) || state.dlmm.lastSyncAt;
    state.dlmm.lastError = remoteState.dlmm.lastError || "";
    state.dlmm.protocolMetrics = remoteState.dlmm.protocolMetrics || state.dlmm.protocolMetrics;
    state.dlmm.pools = Array.isArray(remoteState.dlmm.pools) && remoteState.dlmm.pools.length
      ? remoteState.dlmm.pools
      : state.dlmm.pools;
    if (!state.dlmm.selectedPoolAddress && remoteState.dlmm.selectedPoolAddress) {
      state.dlmm.selectedPoolAddress = remoteState.dlmm.selectedPoolAddress;
    }
  }
}

async function fetchPlaygroundRuntimeState() {
  try {
    let payload;
    try {
      payload = await fetchJson("/api/playground-runtime");
    } catch (_error) {
      payload = await postJson("/api/notify", {
        action: "playground_runtime",
        runtime: {
          action: "get",
        },
      });
    }
    mergePlaygroundRuntimeState(payload);
    return payload;
  } catch (_error) {
    state.backgroundAvailable = false;
    return null;
  }
}

async function syncPlaygroundRuntimeSettings(moduleKey = null) {
  try {
    const settings = {};
    if (!moduleKey || moduleKey === PERPS_MODULE) {
      settings.perps = {
        scannerEnabled: state.perps.scannerEnabled,
        scanIntervalMs: state.perps.scanIntervalMs,
        webhook: state.perps.webhook,
      };
    }
    if (!moduleKey || moduleKey === DLMM_MODULE) {
      settings.dlmm = {
        scannerEnabled: state.dlmm.scannerEnabled,
        scanIntervalMs: state.dlmm.scanIntervalMs,
        webhook: state.dlmm.webhook,
      };
    }
    let payload;
    try {
      payload = await postJson("/api/playground-runtime", {
        action: "settings",
        settings,
      });
    } catch (_error) {
      payload = await postJson("/api/notify", {
        action: "playground_runtime",
        runtime: {
          action: "settings",
          settings,
        },
      });
    }
    mergePlaygroundRuntimeState(payload);
    return payload;
  } catch (_error) {
    return null;
  }
}

async function postPlaygroundRuntime(runtime = {}) {
  try {
    return await postJson("/api/playground-runtime", runtime);
  } catch (_error) {
    return postJson("/api/notify", {
      action: "playground_runtime",
      runtime,
    });
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

async function resolveDlmmPool(poolAddress, query) {
  if (poolAddress) {
    const detail = await fetchJson(`${METEORA_BASE_URL}/pools/${encodeURIComponent(poolAddress)}`);
    return detail.data || detail;
  }

  const pools = await fetchDlmmPools(100);
  const lowered = String(query || "").trim().toLowerCase();
  return pools.find((pool) =>
    `${pool.address || ""} ${pool.name || ""} ${pool.token_x?.symbol || ""} ${pool.token_y?.symbol || ""}`
      .toLowerCase()
      .includes(lowered)
  );
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
    refreshPerpsData({ fullScan: !state.backgroundAvailable, source: "scheduled" });
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

function updatePerpsRecentCall(item) {
  if (!item?.id || !item?.symbol) return;
  const entry = {
    id: item.id,
    symbol: item.symbol,
    engine: "playground",
    engineLabel: "Playground Engine",
    strategy: item.strategy || "Playground Engine",
    side: item.side || "Long",
    status: "Open",
    qualityScore: Number(item.qualityScore) || 0,
    entryPrice: Number(item.entryPrice) || 0,
    stopLoss: Number(item.stopLoss) || 0,
    takeProfit: Number(item.takeProfit) || 0,
    takeProfit2: Number(item.takeProfit2) || 0,
    rr: Number(item.rr) || 0,
    timeframe: item.timeframe || "4H",
    openedAt: Number(item.timestamp) || Date.now(),
    detectedAt: Number(item.timestamp) || Date.now(),
    closedAt: 0,
    returnPct: null,
    pnlUsd: null,
    lastPrice: Number(item.entryPrice) || 0,
    holdMs: 0,
    qualificationReason: item.qualificationReason || "Qualified by Playground Engine.",
  };
  const index = state.perps.recentCalls.findIndex((call) => call.id === item.id);
  if (index >= 0) {
    state.perps.recentCalls[index] = {
      ...state.perps.recentCalls[index],
      ...entry,
    };
  } else {
    state.perps.recentCalls.unshift(entry);
    state.perps.recentCalls = state.perps.recentCalls.slice(0, 160);
  }
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
      Math.max(
        high - low,
        Math.abs(high - previousClose),
        Math.abs(low - previousClose)
      )
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

async function fetchPerpsPlaygroundSignal(symbolInfo) {
  const symbol = String(symbolInfo?.symbol || "").trim().toUpperCase();
  if (!symbol) return null;
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

async function refreshPlaygroundSignals() {
  const runtimeUniverse = Array.isArray(state.perps.runtime.universe) && state.perps.runtime.universe.length
    ? state.perps.runtime.universe
    : PLAYGROUND_FALLBACK_UNIVERSE;
  const selected = selectedPerpsSymbol();
  const priorityUniverse = runtimeUniverse
    .filter((entry) => entry && entry.symbol)
    .sort((left, right) => (Number(right.quoteVolume) || 0) - (Number(left.quoteVolume) || 0));
  const symbols = [];
  if (selected) {
    const selectedEntry = priorityUniverse.find((entry) => entry.symbol === selected) || { symbol: selected, quoteVolume: 0 };
    symbols.push(selectedEntry);
  }
  priorityUniverse.forEach((entry) => {
    if (symbols.length >= 15) return;
    if (!symbols.some((item) => item.symbol === entry.symbol)) {
      symbols.push(entry);
    }
  });

  if (!symbols.length) {
    state.perps.playgroundSignals = [];
    return [];
  }

  const results = await Promise.allSettled(symbols.map((entry) => fetchPerpsPlaygroundSignal(entry)));
  const signals = results
    .map((result) => (result.status === "fulfilled" ? result.value : null))
    .filter(Boolean)
    .sort((left, right) => right.qualityScore - left.qualityScore);

  state.perps.playgroundSignals = signals.slice(0, 12);
  pushModuleLog(PERPS_MODULE, "scanLog", {
    tone: signals.length ? "up" : "neutral",
    message: signals.length
      ? `Playground Engine qualified ${signals.length} live perps setup${signals.length === 1 ? "" : "s"} across ${symbols.length} symbols.`
      : `Playground Engine scanned ${symbols.length} top perps symbols with no fresh setup above Q60.`,
  });
  return signals;
}

function buildPerpsManualScanPayload(symbol) {
  const normalized = String(symbol || "").trim().toUpperCase();
  if (!normalized) return null;

  const playgroundSignal = (state.perps.playgroundSignals || [])
    .filter((candidate) => candidate.symbol === normalized)
    .sort((left, right) => (right.qualityScore || 0) - (left.qualityScore || 0))[0];
  if (playgroundSignal) {
    return {
      ok: true,
      symbol: normalized,
      preferred: createPerpsAlertPayload(playgroundSignal),
      source: playgroundSignal.engineLabel,
      scannedAt: Date.now(),
    };
  }

  return {
    ok: true,
    symbol: normalized,
    preferred: null,
    scannedAt: Date.now(),
    note: "No current Playground Engine signal matched this pair on the latest scan.",
  };
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

  const pair = formatBannerPair(payload.pair || payload.symbol || event.symbol);
  if (moduleKey === PERPS_MODULE) {
    event.type = "perps";
    event.pair = pair;
    event.direction = String(payload.direction || payload.side || event.side || "").trim().toUpperCase();
    event.strategy = String(payload.strategy || "Perps Alerts").trim();
    event.bannerLabel = "NEW PERPS ALERT";
    event.bannerFlashFrames = [event.bannerLabel, pair].filter(Boolean);
    event.bannerTitle = [event.bannerLabel, pair, event.direction].filter(Boolean).join(" | ");
    const _fmtP = (v) => Number.isFinite(Number(v)) && Number(v) > 0 ? `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 4 })}` : "—";
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
  } else if (moduleKey === DLMM_MODULE) {
    event.type = "dlmm";
    event.pair = pair;
    event.pool = String(payload.pool || "").trim();
    event.direction = String(payload.direction || payload.side || "").trim().toUpperCase();
    event.strategy = String(payload.strategy || "DLMM Alerts").trim();
    event.preferredBins = Number(payload.preferredBins) || 0;
    event.fees10m = Number(payload.fees10m) || 0;
    event.fees30m = Number(payload.fees30m) || 0;
    event.fees1h = Number(payload.fees1h) || 0;
    event.fees24h = Number(payload.fees24h) || 0;
    event.bannerLabel = "NEW DLMM ALERT";
    event.bannerFlashFrames = [event.bannerLabel, pair].filter(Boolean);
    event.bannerTitle = [event.bannerLabel, event.strategy, pair].filter(Boolean).join(" | ");
  }

  const response = await postJson("/api/notify", {
    title: event.bannerTitle || title,
    event,
    meta,
    destinations: {
      discordWebhook: webhook,
    },
  });
  if (response?.results?.discord && response.results.discord !== "sent") {
    throw new Error(response.results.discord);
  }
  if (!response?.results?.discord) {
    throw new Error("Discord delivery result was not returned by notify API.");
  }
  return response;
}

async function testWebhook(moduleKey) {
  try {
    await syncPlaygroundRuntimeSettings(moduleKey);
    if (state.backgroundAvailable) {
      const response = await postPlaygroundRuntime({
        action: "test",
        module: moduleKey,
      });
      mergePlaygroundRuntimeState(response);
      updateWebhookHealth(moduleKey, "ok", "Webhook test sent.");
    } else {
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
              preferredBins: 16,
              suggestedRange: "±10%",
              estimatedHoldTime: "1-3 days",
              fees10m: 120,
              fees30m: 340,
              fees1h: 620,
              fees24h: 4800,
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
    }
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
    await fetchPlaygroundRuntimeState();
    if (fullScan) {
      await Promise.allSettled([
        postJson("/api/house-runtime", { action: "scan" }),
        postJson("/api/tradez-runtime", { action: "scan" }),
      ]);
      if (state.backgroundAvailable) {
        await postPlaygroundRuntime({
          action: "scan",
          modules: [PERPS_MODULE],
          settings: {
            perps: {
              scannerEnabled: state.perps.scannerEnabled,
              scanIntervalMs: state.perps.scanIntervalMs,
              webhook: state.perps.webhook,
            },
          },
        }).catch(() => null);
      }
    }

    const [house, tradez, universe, playgroundRuntime] = await Promise.all([
      fetchJson("/api/house-runtime"),
      fetchJson("/api/tradez-runtime"),
      fetchJson("/api/arena-universe"),
      fetchPlaygroundRuntimeState(),
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

    await refreshPlaygroundSignals();

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
  const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
  const deliveredSignalIds = new Set(
    (state.perps.recentCalls || [])
      .filter((call) => Number(call.openedAt || call.detectedAt || 0) > sixHoursAgo)
      .map((call) => call.id)
  );

  const candidates = (state.perps.playgroundSignals || [])
    .filter((candidate) => candidate.qualityScore >= 44 && withinLookback(candidate.timestamp || Date.now()))
    .sort((left, right) => right.qualityScore - left.qualityScore);

  const outbound = [
    ...candidates.map((candidate) => ({
      id: `candidate:${candidate.id}`,
      title: `Playground Engine qualified ${candidate.symbol}`,
      payload: createPerpsAlertPayload(candidate),
      signal: candidate,
    })),
  ];

  for (const item of outbound) {
    if (item.signal && deliveredSignalIds.has(item.signal.id)) continue;
    try {
      await sendWebhookAlert(PERPS_MODULE, item.title, item.payload, {
        source: "playground_perps",
        strategy: "perps_alerts",
        eventType: "scanner_signal",
      });
      pushSentId(PERPS_MODULE, item.id);
      if (item.signal) updatePerpsRecentCall(item.signal);
      if (item.signal) deliveredSignalIds.add(item.signal.id);
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
        existing.binStep = pool.binStep;
        existing.preferredBins = pool.analysis.preferredBins;
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
  if (state.backgroundAvailable) return;
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
        preferredBins: call.preferredBins,
        estimatedHoldTime: call.estimatedHoldTime,
        riskNotes: call.riskNotes,
        monitors: call.monitors,
        qualityScore: call.currentQualityScore,
        qualificationReasons: call.latestNotes,
      },
      binStep: call.binStep || selectedPool()?.binStep || null,
      fees10m: call.fees10m,
      fees30m: call.fees30m,
      fees1h: call.fees1h,
      fees24h: call.fees24h,
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
    await fetchPlaygroundRuntimeState();
    if (state.backgroundAvailable && source === "manual") {
      await postPlaygroundRuntime({
        action: "scan",
        modules: [DLMM_MODULE],
        settings: {
          dlmm: {
            scannerEnabled: state.dlmm.scannerEnabled,
            scanIntervalMs: state.dlmm.scanIntervalMs,
            webhook: state.dlmm.webhook,
          },
        },
      }).catch(() => null);
    }
    const query = String(state.dlmm.selectorQuery || "").trim().toLowerCase();
    const [rawPools, protocolMetrics, playgroundRuntime] = await Promise.all([
      fetchDlmmPools(150),
      fetchDlmmProtocolMetrics(),
      fetchPlaygroundRuntimeState(),
    ]);
    state.dlmm.pools = rawPools
      .map((pool) => shapeDlmmPool(pool))
      .filter((pool) => {
        if (!query) return true;
        return `${pool.address} ${pool.pairLabel} ${pool.baseSymbol} ${pool.quoteSymbol}`
          .toLowerCase()
          .includes(query);
      })
      .sort(
        (left, right) =>
          (right.analysis?.qualityScore || 0) - (left.analysis?.qualityScore || 0) ||
          right.volume24h - left.volume24h
      );
    state.dlmm.protocolMetrics = protocolMetrics || null;
    state.dlmm.lastSyncAt = Date.now();

    if ((!state.dlmm.selectedPoolAddress || !state.dlmm.pools.some((pool) => pool.address === state.dlmm.selectedPoolAddress)) && state.dlmm.pools.length) {
      state.dlmm.selectedPoolAddress = state.dlmm.pools[0].address;
    }

    if (!playgroundRuntime?.backgroundAvailable) {
      updateDlmmCalls(state.dlmm.pools);
      pushModuleLog(DLMM_MODULE, "scanLog", {
        tone: "neutral",
        message:
          source === "scheduled"
            ? "Scheduled DLMM scanner refresh completed."
            : "DLMM pool state refreshed.",
      });
      await maybeSendDlmmAlerts();
    }
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
    const pool = await resolveDlmmPool(poolAddress, query);
    if (!pool) {
      throw new Error("No DLMM pool matched that selector.");
    }
    const address = pool.address || pool.pool_address || pool.pubkey;
    const [detail, ohlcvPayload] = await Promise.all([
      fetchJson(`${METEORA_BASE_URL}/pools/${encodeURIComponent(address)}`),
      fetchJson(`${METEORA_BASE_URL}/pools/${encodeURIComponent(address)}/ohlcv?timeframe=1h`).catch(
        () => ({ data: [] })
      ),
    ]);
    const shaped = shapeDlmmPool(detail.data || detail, ohlcvPayload.data || []);
    const payload = {
      ok: true,
      pool: shaped,
      analysis: shaped.analysis,
      scannedAt: Date.now(),
    };
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
  const perpsEl = document.getElementById("playground-hero-perps-health");
  const perpsNoteEl = document.getElementById("playground-hero-perps-note");

  if (perpsEl) perpsEl.textContent = perpsHealth.label;
  if (perpsNoteEl) perpsNoteEl.textContent = perpsHealth.note;
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

  const selected = selectedPerpsSymbol();
  const current = (state.perps.playgroundSignals || []).find((candidate) => candidate.symbol === selected);
  if (!current) {
    return `<article class="playground-preview-card playground-empty-card"><strong>No current alert preview.</strong><span>Run a manual pair scan to inspect the selected symbol with the latest Playground Engine logic.</span></article>`;
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
        <strong>${moduleKey === PERPS_MODULE ? "Binance + Playground Engine" : "Meteora DLMM"}</strong>
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
  const calls = state.perps.recentCalls || [];
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
  const perpsCalls = state.perps.recentCalls || [];
  const metrics = computePerpsMetrics(perpsCalls);
  const candidates = state.perps.playgroundSignals || [];
  const playgroundSignals = state.perps.playgroundSignals || [];
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
            ${renderPerpsTable(perpsCalls)}
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
            <div class="playground-detail-block">
              <h4>Playground Engine — Live Signals</h4>
              ${
                playgroundSignals.length
                  ? `<div class="playground-chip-row">${playgroundSignals.slice(0, 12).map((signal) => `<span class="playground-chip">${escapeHtml(signal.symbol)} · ${escapeHtml(signal.side)} · Q${formatNumber(signal.qualityScore, 0)}</span>`).join("")}</div>`
                  : `<div class="playground-empty-card"><strong>No current Playground Engine signals.</strong><span>The local 4H Binance fallback engine will list top setups here every scan cycle.</span></div>`
              }
            </div>
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
  const content = document.getElementById("playground-content");
  if (!content) return;
  content.innerHTML = renderPerpsModule();
}

function handleTopTabClick(_target) {
  return false;
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
    await syncPlaygroundRuntimeSettings(PERPS_MODULE);
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

  document.addEventListener("change", async (event) => {
    const handled = handleSelectChange(event.target);
    if (event.target.id === "playground-perps-webhook") {
      await syncPlaygroundRuntimeSettings(PERPS_MODULE);
      return;
    }
    if (event.target.id === "playground-dlmm-webhook") {
      await syncPlaygroundRuntimeSettings(DLMM_MODULE);
      return;
    }
    if (handled) {
      if (event.target.id === "playground-perps-interval") {
        await syncPlaygroundRuntimeSettings(PERPS_MODULE);
      } else if (event.target.id === "playground-dlmm-interval") {
        await syncPlaygroundRuntimeSettings(DLMM_MODULE);
      }
    }
  });
}

async function init() {
  bindEvents();
  render();
  await fetchPlaygroundRuntimeState();
  await syncPlaygroundRuntimeSettings(PERPS_MODULE);
  await refreshPerpsData({ source: "init" });
  schedulePerpsScanner();
}

document.addEventListener("DOMContentLoaded", () => {
  init();
});
