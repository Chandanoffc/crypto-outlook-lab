"use strict";
const upbitNoticeHandler = require("./upbit-notices");
const { hasDatabase, getRuntimeState, upsertRuntimeState } = require("../lib/neon-db");
const { defaultRuntimeState: defaultClaudeState, sanitizeRuntimeState: sanitizeClaudeState, runClaudePerps_Scan } = require("../lib/claudeperps-runtime");
const { defaultRuntimeState: defaultEmaState, sanitizeRuntimeState: sanitizeEmaState, runEmaPerps_Scan } = require("../lib/emaperps-runtime");

const ALERT_WINDOW_MS = 5 * 60 * 1000;
const SCAN_COOLDOWN_MS = 4 * 60 * 1000;

function buildJsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function readAuthToken(req) {
  const header = String(req.headers?.authorization || "");
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function requireAuthorized(req) {
  const expected =
    String(process.env.UPBIT_CRON_SECRET || "").trim() ||
    String(process.env.HOUSE_CRON_SECRET || "").trim() ||
    String(process.env.CRON_SECRET || "").trim();
  if (!expected) throw new Error("Missing UPBIT_CRON_SECRET or CRON_SECRET");
  const actual = readAuthToken(req);
  if (!actual || actual !== expected) {
    const err = new Error("Unauthorized");
    err.statusCode = 401;
    throw err;
  }
}

function scannedRecently(lastScanAt) {
  return Number(lastScanAt) > 0 && Date.now() - Number(lastScanAt) < SCAN_COOLDOWN_MS;
}

function getBaseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.headers.host || "soloris-signals.vercel.app";
  return `${proto}://${host}`;
}

// Upbit alerting
function formatAlertMessage(notice) {
  const tokenLabel = notice.tokenLabel || notice.ticker || notice.title || "Unknown token";
  return `⭐️UPBIT LISTING ALERT\n${tokenLabel}\n${notice.url}`;
}

async function sendDiscord(webhookUrl, notice) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ content: formatAlertMessage(notice) }),
  });
  if (!response.ok) throw new Error(`Discord webhook failed (${response.status})`);
}

async function sendTelegram(botToken, chatId, notice) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ chat_id: chatId, text: formatAlertMessage(notice) }),
  });
  if (!response.ok) throw new Error(`Telegram send failed (${response.status})`);
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

// Background scan helpers
async function runClaudePerpsBackground(baseUrl) {
  if (!hasDatabase()) return { ok: true, skipped: true, reason: "No database." };
  const stored = await getRuntimeState("claudeperps");
  const state = stored.found && stored.state ? sanitizeClaudeState(stored.state) : defaultClaudeState();
  if (scannedRecently(state.lastScanAt)) return { ok: true, skipped: true, reason: "Claudeperps scan is fresh." };
  const result = await runClaudePerps_Scan(state, { manual: false, baseUrl });
  const saved = await upsertRuntimeState("claudeperps", result.state);
  return { ok: true, updatedAt: saved.updatedAt, summary: result.summary };
}

async function runEmaPerpsBackground(baseUrl) {
  if (!hasDatabase()) return { ok: true, skipped: true, reason: "No database." };
  const stored = await getRuntimeState("emaperps");
  const state = stored.found && stored.state ? sanitizeEmaState(stored.state) : defaultEmaState();
  if (scannedRecently(state.lastScanAt)) return { ok: true, skipped: true, reason: "EMA Perps scan is fresh." };
  const result = await runEmaPerps_Scan(state, { manual: false, baseUrl });
  const saved = await upsertRuntimeState("emaperps", result.state);
  return { ok: true, updatedAt: saved.updatedAt, summary: result.summary };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return buildJsonResponse(res, 405, { error: "Method not allowed." });

  try {
    requireAuthorized(req);

    const baseUrl = getBaseUrl(req);
    const destinations = getDestinations();

    // Always run both strategy scans regardless of Upbit config
    const [claudeResult, emaResult] = await Promise.allSettled([
      runClaudePerpsBackground(baseUrl).catch(err => ({ ok: false, error: err.message })),
      runEmaPerpsBackground(baseUrl).catch(err => ({ ok: false, error: err.message })),
    ]);

    const claudeperps = claudeResult.status === "fulfilled" ? claudeResult.value : { ok: false, error: "Promise rejected" };
    const emaperps = emaResult.status === "fulfilled" ? emaResult.value : { ok: false, error: "Promise rejected" };

    // Upbit alerts (optional feature — only if configured)
    if (!destinations.discordWebhook && !(destinations.telegramToken && destinations.telegramChatId)) {
      return buildJsonResponse(res, 200, { ok: true, skipped: true, reason: "No Upbit destinations configured.", claudeperps, emaperps });
    }

    const notices = await upbitNoticeHandler.getUpbitNotices();
    const now = Date.now();
    const freshNotices = notices.filter(n => isFreshMarketSupportNotice(n, now));
    const results = [];

    for (const notice of freshNotices) {
      const outcome = { id: notice.id, title: notice.title, ticker: notice.ticker, url: notice.url };
      if (destinations.discordWebhook) {
        try { await sendDiscord(destinations.discordWebhook, notice); outcome.discord = "sent"; }
        catch (err) { outcome.discord = err.message; }
      }
      if (destinations.telegramToken && destinations.telegramChatId) {
        try { await sendTelegram(destinations.telegramToken, destinations.telegramChatId, notice); outcome.telegram = "sent"; }
        catch (err) { outcome.telegram = err.message; }
      }
      results.push(outcome);
    }

    buildJsonResponse(res, 200, { ok: true, checkedAt: now, checked: notices.length, matched: freshNotices.length, results, claudeperps, emaperps });
  } catch (err) {
    buildJsonResponse(res, err.statusCode || 500, { error: err.message || "Cron job failed." });
  }
};
