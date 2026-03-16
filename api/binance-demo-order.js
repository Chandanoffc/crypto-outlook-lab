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

async function postSigned(path, params, apiKey, secret) {
  const signedQuery = signParams(
    {
      ...params,
      recvWindow: RECV_WINDOW,
      timestamp: Date.now(),
    },
    secret
  );

  const response = await fetch(`${BINANCE_DEMO_BASE_URL}${path}?${signedQuery}`, {
    method: "POST",
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
    const quantity = clampPrecision(Number(body?.quantity), Number(body?.quantityPrecision ?? 3));
    const leverage = Math.max(1, Math.min(50, Number(body?.leverage) || 5));

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

    const orderResult = await postSigned(
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

    buildJsonResponse(res, 200, {
      ok: true,
      symbol,
      side,
      orderId: orderResult.orderId || null,
      status: orderResult.status || "NEW",
      executedQty: orderResult.executedQty || quantity,
      avgPrice: orderResult.avgPrice || null,
      leverage,
      leverageResult,
      environment: "binance-demo",
      note:
        "Entry order sent to Binance Futures demo/testnet. TP1/TP2/SL remain strategy-managed inside Soloris unless a separate bracket adapter is added.",
    });
  } catch (error) {
    buildJsonResponse(res, 400, {
      error: error.message || "Unable to place Binance demo order.",
    });
  }
};
