const { ensureSchema, insertAlertDelivery, insertSignalEvent, insertTradeEvent } = require("../lib/neon-db");

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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    buildJsonResponse(res, 405, {
      error: "Method not allowed.",
    });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const stream = String(body?.stream || "").trim().toLowerCase();
    const event = body?.event || {};

    await ensureSchema();

    let result;
    if (stream === "signal") {
      result = await insertSignalEvent(event);
    } else if (stream === "trade") {
      result = await insertTradeEvent(event);
    } else if (stream === "alert") {
      result = await insertAlertDelivery(event);
    } else {
      buildJsonResponse(res, 400, {
        error: "Unsupported log stream.",
      });
      return;
    }

    buildJsonResponse(res, 200, {
      ok: true,
      stream,
      result,
    });
  } catch (error) {
    buildJsonResponse(res, 500, {
      error: error.message || "Unable to log event.",
    });
  }
};
