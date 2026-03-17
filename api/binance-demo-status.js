const crypto = require("crypto");

const BINANCE_DEMO_BASE_URL =
  process.env.BINANCE_DEMO_BASE_URL || "https://demo-fapi.binance.com";
const RECV_WINDOW = 5000;

function buildJsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }
  return body ? JSON.parse(body) : {};
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function signParams(params, secret) {
  const query = new URLSearchParams(params).toString();
  const signature = crypto.createHmac("sha256", secret).update(query).digest("hex");
  return `${query}&signature=${signature}`;
}

async function signedRequest(path, params, apiKey, secret, method = "GET") {
  const signedQuery = signParams(
    {
      ...params,
      recvWindow: RECV_WINDOW,
      timestamp: Date.now(),
    },
    secret
  );

  const response = await fetch(`${BINANCE_DEMO_BASE_URL}${path}?${signedQuery}`, {
    method,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-MBX-APIKEY": apiKey,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.msg || `${path} failed (${response.status})`);
  }
  return payload;
}

async function getSigned(path, params, apiKey, secret) {
  return signedRequest(path, params, apiKey, secret, "GET");
}

async function fetchOrder(symbol, orderId, apiKey, secret) {
  if (!symbol || !orderId) return null;
  try {
    const payload = await getSigned(
      "/fapi/v1/order",
      {
        symbol,
        orderId,
      },
      apiKey,
      secret
    );
    return {
      orderId: Number(payload.orderId) || Number(orderId),
      clientOrderId: payload.clientOrderId || "",
      status: payload.status || "UNKNOWN",
      type: payload.type || "",
      side: payload.side || "",
      avgPrice: Number(payload.avgPrice) || Number(payload.stopPrice) || Number(payload.price) || null,
      price: Number(payload.price) || Number(payload.stopPrice) || null,
      stopPrice: Number(payload.stopPrice) || null,
      executedQty: Number(payload.executedQty) || 0,
      origQty: Number(payload.origQty) || 0,
      reduceOnly: Boolean(payload.reduceOnly),
      updateTime: Number(payload.updateTime) || 0,
      rawStatus: payload.status || "UNKNOWN",
    };
  } catch (error) {
    return {
      orderId: Number(orderId),
      status: "ERROR",
      error: error.message,
    };
  }
}

async function fetchPosition(symbol, apiKey, secret) {
  if (!symbol) return null;
  try {
    const payload = await getSigned(
      "/fapi/v2/positionRisk",
      {
        symbol,
      },
      apiKey,
      secret
    );
    const positions = Array.isArray(payload) ? payload : [payload];
    const match =
      positions.find((entry) => Math.abs(Number(entry.positionAmt) || 0) > 0) ||
      positions.find((entry) => entry.symbol === symbol) ||
      positions[0] ||
      null;

    if (!match) return null;

    return {
      symbol: match.symbol || symbol,
      positionAmt: Number(match.positionAmt) || 0,
      entryPrice: Number(match.entryPrice) || 0,
      markPrice: Number(match.markPrice) || 0,
      unrealizedProfit: Number(match.unRealizedProfit) || 0,
      liquidationPrice: Number(match.liquidationPrice) || 0,
      leverage: Number(match.leverage) || 0,
      marginType: match.marginType || "",
      isolatedMargin: Number(match.isolatedMargin) || 0,
      updateTime: Number(match.updateTime) || 0,
    };
  } catch (error) {
    return {
      error: error.message,
    };
  }
}

function summarizeRecordStatus(record) {
  const entryStatus = String(record.entryOrder?.status || "").toUpperCase();
  const tp1Status = String(record.tp1Order?.status || "").toUpperCase();
  const tp2Status = String(record.tp2Order?.status || "").toUpperCase();
  const stopStatus = String(record.stopOrder?.status || "").toUpperCase();
  const positionAmt = Math.abs(Number(record.position?.positionAmt) || 0);

  if (stopStatus === "FILLED") return "SL_FILLED";
  if (tp2Status === "FILLED") return "TP2_FILLED";
  if (tp1Status === "FILLED" && positionAmt > 0) return "TP1_FILLED";
  if (entryStatus === "FILLED" && positionAmt > 0) return "LIVE";
  if (entryStatus === "FILLED" && positionAmt === 0 && (tp2Status === "FILLED" || stopStatus === "FILLED")) {
    return tp2Status === "FILLED" ? "TP2_FILLED" : "SL_FILLED";
  }
  if (entryStatus === "ERROR" || tp1Status === "ERROR" || tp2Status === "ERROR" || stopStatus === "ERROR") {
    return "ERROR";
  }
  return "WATCHING";
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    buildJsonResponse(res, 405, {
      error: "Method not allowed.",
    });
    return;
  }

  try {
    const apiKey = requireEnv("BINANCE_DEMO_API_KEY");
    const secret = requireEnv("BINANCE_DEMO_API_SECRET");
    const body = await readJsonBody(req);
    const records = Array.isArray(body?.records) ? body.records : [];

    if (!records.length) {
      buildJsonResponse(res, 200, {
        ok: true,
        records: [],
      });
      return;
    }

    const results = [];
    for (const input of records.slice(0, 20)) {
      const symbol = String(input?.symbol || "").trim().toUpperCase();
      if (!symbol) continue;

      const entryOrder = await fetchOrder(symbol, input?.entryOrderId, apiKey, secret);
      const tp1Order = await fetchOrder(symbol, input?.tp1OrderId, apiKey, secret);
      const tp2Order = await fetchOrder(symbol, input?.tp2OrderId, apiKey, secret);
      const stopOrder = await fetchOrder(symbol, input?.stopOrderId, apiKey, secret);
      const position = await fetchPosition(symbol, apiKey, secret);
      const warnings = [entryOrder, tp1Order, tp2Order, stopOrder, position]
        .filter((item) => item && item.error)
        .map((item) => item.error);

      const normalized = {
        id: String(input?.id || symbol),
        symbol,
        checkedAt: Date.now(),
        entryOrder,
        tp1Order,
        tp2Order,
        stopOrder,
        position,
        warnings,
      };

      results.push({
        ...normalized,
        overallStatus: summarizeRecordStatus(normalized),
      });
    }

    buildJsonResponse(res, 200, {
      ok: true,
      environment: "binance-demo",
      records: results,
    });
  } catch (error) {
    buildJsonResponse(res, 400, {
      error: error.message || "Unable to query Binance demo status.",
    });
  }
};
