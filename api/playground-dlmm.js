const METEORA_BASE_URL = "https://dlmm.datapi.meteora.ag";

function buildJsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }
  return body ? JSON.parse(body) : {};
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Official Meteora API failed (${response.status})`);
  }
  return payload;
}

function normalizeTimestamp(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed > 10_000_000_000 ? parsed : parsed * 1000;
}

function pctChange(start, end) {
  if (!Number.isFinite(Number(start)) || !Number.isFinite(Number(end)) || Number(start) === 0) return 0;
  return ((Number(end) - Number(start)) / Math.abs(Number(start))) * 100;
}

function priceStats(candles = []) {
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

function deriveRange(strategy, volatilityPct) {
  if (strategy === "Curve") return `±${Math.max(6, Math.min(14, volatilityPct * 1.6 || 8)).toFixed(0)}%`;
  if (strategy === "BidAsk") return `±${Math.max(16, Math.min(32, volatilityPct * 2.2 || 20)).toFixed(0)}%`;
  return `±${Math.max(10, Math.min(22, volatilityPct * 1.9 || 14)).toFixed(0)}%`;
}

function deriveHoldTime(strategy, ageDays, activityRatio) {
  if (strategy === "Curve") return activityRatio > 0.2 ? "12-48 hours" : "1-3 days";
  if (strategy === "BidAsk") return ageDays < 14 ? "6-24 hours" : "12-36 hours";
  return activityRatio > 0.15 ? "1-3 days" : "2-5 days";
}

function deriveStrategy(pool, stats) {
  if (stats.volatilityPct <= 4 && pool.feeTvlRatio24h >= 0.35 && pool.tvl >= 250_000) return "Curve";
  if (stats.volatilityPct >= 8 || pool.activityRatio >= 0.28 || pool.binStep >= 25) return "BidAsk";
  return "Spot";
}

function buildAnalysis(pool, stats) {
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

  const strategy = deriveStrategy(pool, stats);
  const suggestedRange = deriveRange(strategy, stats.volatilityPct);
  const estimatedHoldTime = deriveHoldTime(strategy, pool.ageDays, pool.activityRatio);
  const edgeScore = pool.feeTvlRatio24h * 100 + pool.totalApr * 0.35 + pool.activityRatio * 40;

  monitors.push(`24H volume ${pool.volume24h.toFixed(0)}`);
  monitors.push(`TVL ${pool.tvl.toFixed(0)}`);
  monitors.push(`Fee/TVL 24H ${pool.feeTvlRatio24h.toFixed(2)}%`);
  monitors.push(`Bin step ${pool.binStep}`);
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
    suggestedRange,
    estimatedHoldTime,
    summary: `${strategy} setup with ${pool.activityRatio.toFixed(2)} activity ratio, ${pool.feeTvlRatio24h.toFixed(2)}% fee/TVL, and ${pool.ageDays.toFixed(0)} day pool age.`,
    qualificationReasons: reasons.length ? reasons : ["Pool remains monitorable but is not yet exceptional."],
    riskNotes: riskNotes.length ? riskNotes : ["No structural risk flags from the latest official pool state."],
    monitors,
    qualifies,
  };
}

function shapePool(rawPool = {}, candles = []) {
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
  const stats = priceStats(candles);
  const pool = {
    address: rawPool.address || rawPool.pool_address || rawPool.pubkey || "",
    pairLabel: rawPool.name || `${baseToken.symbol || baseToken.mint_symbol || "Unknown"}/${quoteToken.symbol || quoteToken.mint_symbol || "Unknown"}`,
    baseSymbol: baseToken.symbol || baseToken.mint_symbol || "Unknown",
    quoteSymbol: quoteToken.symbol || quoteToken.mint_symbol || "Unknown",
    volume24h,
    tvl,
    feeTvlRatio24h,
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
    analysis: buildAnalysis(pool, stats),
  };
}

async function fetchPools(pageSize = 150) {
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

async function fetchProtocolMetrics() {
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

async function resolvePool(poolAddress, query) {
  if (poolAddress) {
    const detail = await fetchJson(`${METEORA_BASE_URL}/pools/${encodeURIComponent(poolAddress)}`);
    return detail.data || detail;
  }

  const pools = await fetchPools(100);
  const lowered = String(query || "").trim().toLowerCase();
  return pools.find((pool) =>
    `${pool.address || ""} ${pool.name || ""} ${pool.token_x?.symbol || ""} ${pool.token_y?.symbol || ""}`
      .toLowerCase()
      .includes(lowered)
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    buildJsonResponse(res, 405, {
      error: "Method not allowed.",
    });
    return;
  }

  try {
    if (req.method === "GET") {
      const url = new URL(req.url, "https://soloris-signals.vercel.app");
      const query = String(url.searchParams.get("query") || "").trim().toLowerCase();
      const pageSize = Math.max(25, Math.min(200, Number(url.searchParams.get("pageSize")) || 150));
      const [rawPools, protocolMetrics] = await Promise.all([
        fetchPools(pageSize),
        fetchProtocolMetrics(),
      ]);
      const pools = rawPools
        .map((pool) => shapePool(pool))
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

      buildJsonResponse(res, 200, {
        ok: true,
        protocolMetrics,
        pools,
        generatedAt: Date.now(),
      });
      return;
    }

    const body = await readJsonBody(req);
    const poolAddress = String(body?.poolAddress || "").trim();
    const query = String(body?.query || "").trim();
    const pool = await resolvePool(poolAddress, query);
    if (!pool) {
      buildJsonResponse(res, 404, {
        error: "No DLMM pool matched that selector.",
      });
      return;
    }

    const address = pool.address || pool.pool_address || pool.pubkey;
    const [detail, ohlcvPayload] = await Promise.all([
      fetchJson(`${METEORA_BASE_URL}/pools/${encodeURIComponent(address)}`),
      fetchJson(`${METEORA_BASE_URL}/pools/${encodeURIComponent(address)}/ohlcv?timeframe=1h`).catch(
        () => ({ data: [] })
      ),
    ]);
    const shaped = shapePool(detail.data || detail, ohlcvPayload.data || []);

    buildJsonResponse(res, 200, {
      ok: true,
      pool: shaped,
      analysis: shaped.analysis,
      scannedAt: Date.now(),
    });
  } catch (error) {
    buildJsonResponse(res, 500, {
      error: error.message || "DLMM scanner failed.",
    });
  }
};
