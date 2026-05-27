const { hasDatabase, queryCompetitionStats } = require("../lib/neon-db");

function buildJsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function parseStrategy(rows, strategy) {
  const strategyRows = rows.filter((row) => row.strategy === strategy);
  const tpRow = strategyRows.find((row) => row.event_type === "tp_hit") || {};
  const slRow = strategyRows.find((row) => row.event_type === "sl_hit") || {};
  const beRow = strategyRows.find((row) => row.event_type === "break_even_exit") || {};

  const tpCount = parseInt(tpRow.count || "0", 10);
  const slCount = parseInt(slRow.count || "0", 10);
  const beCount = parseInt(beRow.count || "0", 10);
  const resolved = tpCount + slCount + beCount;
  const winRate = resolved > 0 ? (tpCount / resolved) * 100 : 0;

  const avgGainPct = parseFloat(tpRow.avg_return_pct) || 0;
  const avgLossPct = parseFloat(slRow.avg_return_pct) || 0;

  const totalPnlUsd =
    (parseFloat(tpRow.total_pnl_usd) || 0) +
    (parseFloat(slRow.total_pnl_usd) || 0) +
    (parseFloat(beRow.total_pnl_usd) || 0);

  const allAvgQuality = strategyRows
    .map((row) => parseFloat(row.avg_quality) || 0)
    .filter((value) => value > 0);
  const avgQuality =
    allAvgQuality.length > 0
      ? allAvgQuality.reduce((sum, value) => sum + value, 0) / allAvgQuality.length
      : 0;

  const expectancy =
    resolved > 0
      ? (winRate / 100) * avgGainPct + ((100 - winRate) / 100) * avgLossPct
      : 0;

  return {
    strategy,
    tpCount,
    slCount,
    beCount,
    resolved,
    winRate: Math.round(winRate * 10) / 10,
    avgGainPct: Math.round(avgGainPct * 100) / 100,
    avgLossPct: Math.round(avgLossPct * 100) / 100,
    totalPnlUsd: Math.round(totalPnlUsd * 100) / 100,
    avgQuality: Math.round(avgQuality * 10) / 10,
    expectancy: Math.round(expectancy * 100) / 100,
  };
}

function determineLeader(house, ema) {
  let houseScore = 0;
  let emaScore = 0;

  if (house.winRate > ema.winRate) houseScore += 1;
  else if (ema.winRate > house.winRate) emaScore += 1;

  if (house.totalPnlUsd > ema.totalPnlUsd) houseScore += 2;
  else if (ema.totalPnlUsd > house.totalPnlUsd) emaScore += 2;

  if (house.expectancy > ema.expectancy) houseScore += 1;
  else if (ema.expectancy > house.expectancy) emaScore += 1;

  if (houseScore > emaScore) return "house_trend";
  if (emaScore > houseScore) return "ema_book";
  return "tied";
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    buildJsonResponse(res, 405, { error: "Method not allowed." });
    return;
  }

  try {
    if (!hasDatabase()) {
      buildJsonResponse(res, 200, {
        ok: true,
        available: false,
        note: "Database is not configured. Competition stats require NeonDB.",
        house: null,
        ema: null,
        leader: null,
        lookbackHours: 0,
        generatedAt: Date.now(),
      });
      return;
    }

    const rawLookback = req.url ? new URL(req.url, "http://localhost").searchParams.get("lookback") : null;
    const lookbackHours = Math.max(1, Math.min(8760, parseInt(rawLookback || "720", 10)));

    const result = await queryCompetitionStats(lookbackHours);

    if (result.skipped) {
      buildJsonResponse(res, 200, {
        ok: true,
        available: false,
        note: result.reason,
        house: null,
        ema: null,
        leader: null,
        lookbackHours,
        generatedAt: Date.now(),
      });
      return;
    }

    const rows = result.rows || [];
    const house = parseStrategy(rows, "house_trend");
    const ema = parseStrategy(rows, "ema_book");
    const leader = determineLeader(house, ema);

    buildJsonResponse(res, 200, {
      ok: true,
      available: true,
      house,
      ema,
      leader,
      lookbackHours,
      generatedAt: Date.now(),
    });
  } catch (error) {
    buildJsonResponse(res, 500, {
      error: error.message || "Unable to build competition report.",
    });
  }
};
