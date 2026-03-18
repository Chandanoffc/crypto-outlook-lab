const { ensureSchema, hasDatabase } = require("../lib/neon-db");

function buildJsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    buildJsonResponse(res, 405, {
      error: "Method not allowed. Use GET or POST.",
    });
    return;
  }

  if (!hasDatabase()) {
    buildJsonResponse(res, 400, {
      ok: false,
      error: "DATABASE_URL is not configured in Vercel.",
    });
    return;
  }

  try {
    await ensureSchema();
    buildJsonResponse(res, 200, {
      ok: true,
      message: "Neon schema initialized successfully.",
      tables: ["signal_events", "trade_events", "alert_deliveries"],
    });
  } catch (error) {
    buildJsonResponse(res, 500, {
      ok: false,
      error: error.message || "Unable to initialize Neon schema.",
    });
  }
};
