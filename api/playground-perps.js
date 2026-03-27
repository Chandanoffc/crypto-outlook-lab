const {
  fetchDirectSnapshot: fetchTradezSnapshot,
  buildTradezSignals,
} = require("../lib/tradez-runtime");
const {
  fetchDirectSnapshot: fetchHouseSnapshot,
  analyzeSnapshot,
  fetchHigherTimeframeConfirmation,
  applyCandidateConfirmation,
} = require("../lib/house-runtime");

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

function buildPreferredAlert(symbol, tradezCandidate, houseCandidate) {
  if (tradezCandidate?.activeSignal) {
    const signal = tradezCandidate.activeSignal;
    return {
      pair: symbol,
      direction: signal.side,
      strategy: "EMA 20/50 Pullback",
      confidence: signal.qualityScore || tradezCandidate.qualityScore || 0,
      entry: signal.entryLow || tradezCandidate.currentPrice || 0,
      stop: signal.stopLoss || 0,
      takeProfit: signal.tp1 || 0,
      rr: signal.rr || 0,
      timeframe: "1H",
      timestamp: signal.detectedAt || Date.now(),
      qualificationReason:
        (Array.isArray(signal.reasonParts) ? signal.reasonParts.join(" • ") : "") ||
        signal.note ||
        tradezCandidate.setupBias?.summary ||
        "Qualified by Tradez signal logic.",
    };
  }

  if (houseCandidate?.trade) {
    return {
      pair: symbol,
      direction: houseCandidate.trade.stance === "Short" ? "Short" : "Long",
      strategy: houseCandidate.trade.mode === "breakout" ? "House Breakout" : "House Trend",
      confidence: houseCandidate.refinedQualityScore || houseCandidate.qualityScore || 0,
      entry: houseCandidate.trade.entry || houseCandidate.currentPrice || 0,
      stop: houseCandidate.trade.stopLoss || 0,
      takeProfit: houseCandidate.trade.takeProfit || 0,
      rr: houseCandidate.trade.rr || houseCandidate.rr || 0,
      timeframe: String(houseCandidate.interval || "15m").toUpperCase(),
      timestamp: houseCandidate.analyzedAt || Date.now(),
      qualificationReason:
        houseCandidate.summary ||
        houseCandidate.trade?.entryReason ||
        "Qualified by House continuation logic.",
    };
  }

  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    buildJsonResponse(res, 405, {
      error: "Method not allowed.",
    });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const symbol = String(body?.symbol || "").trim().toUpperCase();
    if (!symbol) {
      buildJsonResponse(res, 400, {
        error: "A symbol is required for manual perps scans.",
      });
      return;
    }

    const thresholds = body?.qualityThresholds || {};
    const [tradezSnapshot, houseSnapshot] = await Promise.all([
      fetchTradezSnapshot(symbol),
      fetchHouseSnapshot(symbol, "15m"),
    ]);

    const tradezCandidate = buildTradezSignals(
      tradezSnapshot,
      Number(tradezSnapshot.ticker?.quoteVolume) || 0
    );

    const baseHouseCandidate = analyzeSnapshot(houseSnapshot);
    const confirmation = await fetchHigherTimeframeConfirmation(houseSnapshot.symbol);
    const houseCandidate = applyCandidateConfirmation(
      baseHouseCandidate,
      { quoteVolume: Number(houseSnapshot.ticker?.quoteVolume) || 0 },
      confirmation,
      Number(thresholds.house) || 64
    );

    buildJsonResponse(res, 200, {
      ok: true,
      symbol: tradezSnapshot.symbol || houseSnapshot.symbol || symbol,
      tradez: tradezCandidate,
      house: houseCandidate,
      preferred: buildPreferredAlert(symbol, tradezCandidate, houseCandidate),
      scannedAt: Date.now(),
    });
  } catch (error) {
    buildJsonResponse(res, 500, {
      error: error.message || "Manual perps scan failed.",
    });
  }
};
