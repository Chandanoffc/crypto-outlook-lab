const upbitNoticeHandler = require("./upbit-notices");
const { hasDatabase, getRuntimeState, upsertRuntimeState } = require("../lib/neon-db");
const { defaultRuntimeState, runHouseScan, sanitizeRuntimeState } = require("../lib/house-runtime");
const {
  defaultRuntimeState: defaultTradezRuntimeState,
  runTradezScan,
  sanitizeRuntimeState: sanitizeTradezRuntimeState,
} = require("../lib/tradez-runtime");
const {
  defaultRuntimeState: defaultPlaygroundRuntimeState,
  runPlaygroundScan,
  sanitizeRuntimeState: sanitizePlaygroundRuntimeState,
} = require("../lib/playground-runtime");

const ALERT_WINDOW_MS = 5 * 60 * 1000;

function buildJsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function readAuthToken(req) {
  const header = String(req.headers?.authorization || "");
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return "";
}

function requireAuthorized(req) {
  const expected = String(process.env.UPBIT_CRON_SECRET || "").trim();
  if (!expected) {
    throw new Error("Missing UPBIT_CRON_SECRET");
  }
  const actual = readAuthToken(req);
  if (!actual || actual !== expected) {
    const error = new Error("Unauthorized");
    error.statusCode = 401;
    throw error;
  }
}

function formatAlertMessage(notice) {
  const tokenLabel = notice.tokenLabel || notice.ticker || notice.title || "Unknown token";
  return `⭐️UPBIT LISTING ALERT\n${tokenLabel}\n${notice.url}`;
}

async function sendDiscord(webhookUrl, notice) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      content: formatAlertMessage(notice),
    }),
  });

  if (!response.ok) {
    throw new Error(`Discord webhook failed (${response.status})`);
  }
}

async function sendTelegram(botToken, chatId, notice) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: formatAlertMessage(notice),
      disable_web_page_preview: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Telegram send failed (${response.status})`);
  }
}

function getDestinations() {
  return {
    discordWebhook: String(process.env.UPBIT_DISCORD_WEBHOOK || "").trim(),
    telegramToken: String(process.env.UPBIT_TELEGRAM_TOKEN || "").trim(),
    telegramChatId: String(process.env.UPBIT_TELEGRAM_CHAT_ID || "").trim(),
  };
}

function isFreshMarketSupportNotice(notice, now) {
  if (!notice?.isMarketSupport || !notice?.publishedAt) return false;
  const ageMs = now - Number(notice.publishedAt);
  return ageMs >= 0 && ageMs <= ALERT_WINDOW_MS;
}

async function runHouseBackgroundScan() {
  if (!hasDatabase()) {
    return {
      ok: true,
      skipped: true,
      reason: "DATABASE_URL not configured.",
    };
  }

  const stored = await getRuntimeState("house_auto_trade");
  const currentState =
    stored.found && stored.state ? sanitizeRuntimeState(stored.state) : defaultRuntimeState();
  const result = await runHouseScan(currentState, { manual: false });
  const saved = await upsertRuntimeState("house_auto_trade", result.state);

  return {
    ok: true,
    updatedAt: saved.updatedAt,
    summary: result.summary,
  };
}

async function runTradezBackgroundScan() {
  if (!hasDatabase()) {
    return {
      ok: true,
      skipped: true,
      reason: "DATABASE_URL not configured.",
    };
  }

  const stored = await getRuntimeState("tradez_auto_trade");
  const currentState =
    stored.found && stored.state ? sanitizeTradezRuntimeState(stored.state) : defaultTradezRuntimeState();
  const result = await runTradezScan(currentState, { manual: false });
  const saved = await upsertRuntimeState("tradez_auto_trade", result.state);

  return {
    ok: true,
    updatedAt: saved.updatedAt,
    summary: result.summary,
  };
}

async function runPlaygroundBackgroundScan(req) {
  if (!hasDatabase()) {
    return {
      ok: true,
      skipped: true,
      reason: "DATABASE_URL not configured.",
    };
  }

  const stored = await getRuntimeState("playground_ops");
  const currentState =
    stored.found && stored.state ? sanitizePlaygroundRuntimeState(stored.state) : defaultPlaygroundRuntimeState();
  const forwardedProto = req.headers["x-forwarded-proto"];
  const forwardedHost = req.headers["x-forwarded-host"];
  const proto = forwardedProto ? String(forwardedProto).split(",")[0].trim() : "https";
  const host = forwardedHost || req.headers.host || "soloris-signals.vercel.app";
  const baseUrl = `${proto}://${host}`;
  const result = await runPlaygroundScan(currentState, { manual: false, baseUrl });
  const saved = await upsertRuntimeState("playground_ops", result.state);

  return {
    ok: true,
    updatedAt: saved.updatedAt,
    summary: result.summary,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    buildJsonResponse(res, 405, {
      error: "Method not allowed.",
    });
    return;
  }

  try {
    requireAuthorized(req);
    const houseScanPromise = runHouseBackgroundScan().catch((error) => ({
      ok: false,
      error: error.message || "House background scan failed.",
    }));
    const tradezScanPromise = runTradezBackgroundScan().catch((error) => ({
      ok: false,
      error: error.message || "Tradez background scan failed.",
    }));
    const destinations = getDestinations();
    if (!destinations.discordWebhook && !(destinations.telegramToken && destinations.telegramChatId)) {
      const houseAutoTrade = await houseScanPromise;
      const tradezAutoTrade = await tradezScanPromise;
      const playgroundOps = await runPlaygroundBackgroundScan(req).catch((error) => ({
        ok: false,
        error: error.message || "Playground background scan failed.",
      }));
      buildJsonResponse(res, 200, {
        ok: true,
        skipped: true,
        reason: "No Upbit delivery destinations configured.",
        houseAutoTrade,
        tradezAutoTrade,
        playgroundOps,
      });
      return;
    }

    const notices = await upbitNoticeHandler.getUpbitNotices();
    const now = Date.now();
    const freshNotices = notices.filter((notice) => isFreshMarketSupportNotice(notice, now));
    const results = [];

    for (const notice of freshNotices) {
      const outcome = {
        id: notice.id,
        title: notice.title,
        ticker: notice.ticker,
        url: notice.url,
      };

      if (destinations.discordWebhook) {
        try {
          await sendDiscord(destinations.discordWebhook, notice);
          outcome.discord = "sent";
        } catch (error) {
          outcome.discord = error.message;
        }
      }

      if (destinations.telegramToken && destinations.telegramChatId) {
        try {
          await sendTelegram(destinations.telegramToken, destinations.telegramChatId, notice);
          outcome.telegram = "sent";
        } catch (error) {
          outcome.telegram = error.message;
        }
      }

      results.push(outcome);
    }

    const houseAutoTrade = await houseScanPromise;
    const tradezAutoTrade = await tradezScanPromise;
    const playgroundOps = await runPlaygroundBackgroundScan(req).catch((error) => ({
      ok: false,
      error: error.message || "Playground background scan failed.",
    }));

    buildJsonResponse(res, 200, {
      ok: true,
      checkedAt: now,
      checked: notices.length,
      matched: freshNotices.length,
      results,
      houseAutoTrade,
      tradezAutoTrade,
      playgroundOps,
    });
  } catch (error) {
    buildJsonResponse(res, error.statusCode || 500, {
      error: error.message || "Unable to process Upbit cron job.",
    });
  }
};
