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

function toSide(side) {
  return side === "Short" ? "SELL" : "BUY";
}

function oppositeSide(side) {
  return side === "BUY" ? "SELL" : "BUY";
}

function clampPrecision(value, precision = 3) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value
    .toFixed(Math.max(0, Math.min(8, precision)))
    .replace(/\.?0+$/, "");
}

function signParams(params, secret) {
  const query = new URLSearchParams(params).toString();
  const signature = crypto.createHmac("sha256", secret).update(query).digest("hex");
  return `${query}&signature=${signature}`;
}

async function signedRequest(path, params, apiKey, secret, method = "POST") {
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

async function postSigned(path, params, apiKey, secret) {
  return signedRequest(path, params, apiKey, secret, "POST");
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

    const symbol = String(body?.symbol || "").trim().toUpperCase();
    const side = toSide(String(body?.side || "").trim());
    const quantityPrecision = Number(body?.quantityPrecision ?? 3);
    const pricePrecision = Number(body?.pricePrecision ?? 3);
    const quantity = clampPrecision(Number(body?.quantity), quantityPrecision);
    const leverage = Math.max(1, Math.min(50, Number(body?.leverage) || 5));
    const stopLoss = clampPrecision(Number(body?.stopLoss), pricePrecision);
    const tp1Price = clampPrecision(Number(body?.tp1), pricePrecision);
    const tp2Price = clampPrecision(Number(body?.tp2), pricePrecision);

    if (!symbol || !quantity) {
      throw new Error("Symbol and quantity are required for Binance demo execution.");
    }

    let leverageResult = null;
    try {
      leverageResult = await postSigned(
        "/fapi/v1/leverage",
        {
          symbol,
          leverage,
        },
        apiKey,
        secret
      );
    } catch (error) {
      leverageResult = {
        warning: error.message,
      };
    }

    const entryOrder = await postSigned(
      "/fapi/v1/order",
      {
        symbol,
        side,
        type: "MARKET",
        quantity,
        newOrderRespType: "RESULT",
      },
      apiKey,
      secret
    );

    const executedQty = Number(entryOrder.executedQty || quantity);
    const exitSide = oppositeSide(side);
    const warnings = [];

    async function stageBracket(label, params) {
      try {
        return await postSigned("/fapi/v1/order", params, apiKey, secret);
      } catch (error) {
        warnings.push(`${label}: ${error.message}`);
        return null;
      }
    }

    const tp1QtyNumber = Number(clampPrecision(executedQty / 2, quantityPrecision));
    const tp2QtyNumber = Number(
      clampPrecision(Math.max(executedQty - tp1QtyNumber, 0), quantityPrecision)
    );

    const tp1Order =
      tp1QtyNumber > 0 && tp1Price
        ? await stageBracket("TP1", {
            symbol,
            side: exitSide,
            type: "LIMIT",
            timeInForce: "GTC",
            reduceOnly: "true",
            quantity: clampPrecision(tp1QtyNumber, quantityPrecision),
            price: tp1Price,
          })
        : null;

    const tp2Order =
      tp2QtyNumber > 0 && tp2Price
        ? await stageBracket("TP2", {
            symbol,
            side: exitSide,
            type: "LIMIT",
            timeInForce: "GTC",
            reduceOnly: "true",
            quantity: clampPrecision(tp2QtyNumber, quantityPrecision),
            price: tp2Price,
          })
        : null;

    const stopOrder = stopLoss
      ? await stageBracket("Stop", {
          symbol,
          side: exitSide,
          type: "STOP_MARKET",
          stopPrice: stopLoss,
          closePosition: "true",
          workingType: "MARK_PRICE",
        })
      : null;

    buildJsonResponse(res, 200, {
      ok: true,
      symbol,
      side,
      orderId: entryOrder.orderId || null,
      status: entryOrder.status || "NEW",
      executedQty: entryOrder.executedQty || quantity,
      avgPrice: entryOrder.avgPrice || null,
      leverage,
      leverageResult,
      overallStatus: warnings.length ? "PARTIAL_BRACKET" : "STAGED",
      entryOrder: {
        orderId: entryOrder.orderId || null,
        status: entryOrder.status || "NEW",
        avgPrice: Number(entryOrder.avgPrice) || Number(body?.entryPrice) || null,
        executedQty: Number(entryOrder.executedQty) || executedQty,
        type: "MARKET",
      },
      tp1Order: tp1Order
        ? {
            orderId: tp1Order.orderId || null,
            status: tp1Order.status || "NEW",
            price: Number(tp1Price) || Number(body?.tp1) || null,
            quantity: tp1QtyNumber,
            type: "LIMIT",
          }
        : null,
      tp2Order: tp2Order
        ? {
            orderId: tp2Order.orderId || null,
            status: tp2Order.status || "NEW",
            price: Number(tp2Price) || Number(body?.tp2) || null,
            quantity: tp2QtyNumber,
            type: "LIMIT",
          }
        : null,
      stopOrder: stopOrder
        ? {
            orderId: stopOrder.orderId || null,
            status: stopOrder.status || "NEW",
            price: Number(stopLoss) || Number(body?.stopLoss) || null,
            quantity: executedQty,
            type: "STOP_MARKET",
          }
        : null,
      warnings,
      environment: "binance-demo",
      note:
        "Entry and bracket orders were sent to Binance Futures demo/testnet. Reduce-only TP1/TP2 and a close-position stop are staged server-side.",
    });
  } catch (error) {
    buildJsonResponse(res, 400, {
      error: error.message || "Unable to place Binance demo order.",
    });
  }
};
