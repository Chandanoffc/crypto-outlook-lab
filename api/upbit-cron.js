"use strict";

/**
 * upbit-cron.js
 *
 * Called every 5 min by GitHub Actions.  Does three things:
 *
 *  1. NEW LISTING DETECTION
 *     Fetches the current Upbit KRW market list, diffs against the stored
 *     snapshot in NeonDB, and fires Discord/Telegram alerts for any new
 *     entries.  Uses seen-IDs rather than time-window freshness so no alert
 *     is ever missed or duplicated across restarts.
 *
 *  2. PERPS BACKGROUND SCANS (claudeperps + emaperps)
 *     Piggybacks on this cron to keep the strategies running when the site
 *     has no visitors.
 *
 *  3. ALWAYS RETURNS 200
 *     Errors are captured and returned in the JSON body.  curl --fail only
 *     triggers on HTTP 4xx/5xx — non-critical failures must never cause the
 *     GitHub Actions job to show red.
 */

const { getUpbitMarkets, findNewListings } = require("./upbit-notices");
const { hasDatabase, getRuntimeState, upsertRuntimeState } = require("../lib/neon-db");
const {
  defaultRuntimeState: defaultClaudeState,
  sanitizeRuntimeState: sanitizeClaudeState,
  runClaudePerps_Scan,
} = require("../lib/claudeperps-runtime");
const {
  defaultRuntimeState: defaultEmaState,
  sanitizeRuntimeState: sanitizeEmaState,
  runEmaPerps_Scan,
} = require("../lib/emaperps-runtime");

const SCAN_COOLDOWN_MS = 4 * 60 * 1000;       // 4 min between perps scans
const DB_KEY_UPBIT = "upbit_monitor_state";    // NeonDB key for market snapshot

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  if (!expected) throw new Error("No CRON_SECRET configured on this deployment.");
  const actual = readAuthToken(req);
  if (!actual || actual !== expected) {
    const err = new Error("Unauthorized");
    err.statusCode = 401;
    throw err;
  }
}

function getBaseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.headers.host || "soloris-signals.vercel.app";
  return `${proto}://${host}`;
}

function scannedRecently(lastScanAt) {
  return Number(lastScanAt) > 0 && Date.now() - Number(lastScanAt) < SCAN_COOLDOWN_MS;
}

// ─── Alert destinations ───────────────────────────────────────────────────────

function getDestinations() {
  return {
    discordWebhook:  String(process.env.UPBIT_DISCORD_WEBHOOK  || "").trim(),
    telegramToken:   String(process.env.UPBIT_TELEGRAM_TOKEN   || "").trim(),
    telegramChatId:  String(process.env.UPBIT_TELEGRAM_CHAT_ID || "").trim(),
  };
}

function formatAlertMessage(listing) {
  return [
    `⭐️ UPBIT NEW LISTING`,
    `${listing.tokenLabel}`,
    `Market: ${listing.market}`,
    listing.url,
  ].join("\n");
}

async function sendDiscord(webhookUrl, listing) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ content: formatAlertMessage(listing) }),
  });
  if (!response.ok) throw new Error(`Discord webhook failed (${response.status})`);
}

async function sendTelegram(botToken, chatId, listing) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ chat_id: chatId, text: formatAlertMessage(listing) }),
  });
  if (!response.ok) throw new Error(`Telegram send failed (${response.status})`);
}

// ─── Upbit listing monitor ────────────────────────────────────────────────────

async function runUpbitMonitor(destinations) {
  const result = {
    ok: true,
    checkedAt: Date.now(),
    currentKrwCount: 0,
    previousKrwCount: 0,
    newListings: [],
    alerts: [],
    error: null,
  };

  try {
    // Load snapshot from NeonDB
    let knownMarketIds = [];
    let isFirstRun = false;
    if (hasDatabase()) {
      const stored = await getRuntimeState(DB_KEY_UPBIT).catch(() => ({ found: false }));
      if (stored.found && Array.isArray(stored.state?.knownMarketIds)) {
        knownMarketIds = stored.state.knownMarketIds;
        result.previousKrwCount = knownMarketIds.length;
      } else {
        isFirstRun = true;
      }
    }

    // Fetch current market list
    const allMarkets = await getUpbitMarkets();
    const krwMarkets = allMarkets.filter(m => m.market?.startsWith("KRW-"));
    const currentIds  = krwMarkets.map(m => m.market);
    result.currentKrwCount = currentIds.length;

    // Diff — skip alerting on first run (just establish baseline)
    const newListings = isFirstRun ? [] : findNewListings(allMarkets, knownMarketIds);
    result.newListings = newListings.map(l => ({ market: l.market, tokenLabel: l.tokenLabel }));

    // Alert
    const hasDiscord   = Boolean(destinations.discordWebhook);
    const hasTelegram  = Boolean(destinations.telegramToken && destinations.telegramChatId);

    for (const listing of newListings) {
      const outcome = { market: listing.market };
      if (hasDiscord) {
        try { await sendDiscord(destinations.discordWebhook, listing); outcome.discord = "sent"; }
        catch (err) { outcome.discord = err.message; }
      }
      if (hasTelegram) {
        try { await sendTelegram(destinations.telegramToken, destinations.telegramChatId, listing); outcome.telegram = "sent"; }
        catch (err) { outcome.telegram = err.message; }
      }
      result.alerts.push(outcome);
    }

    // Save updated snapshot (cap at 2000 entries so the DB blob doesn't grow forever)
    if (hasDatabase()) {
      // Merge old + new, keep most recent 2000
      const mergedIds = [...new Set([...knownMarketIds, ...currentIds])].slice(-2000);
      await upsertRuntimeState(DB_KEY_UPBIT, {
        knownMarketIds: mergedIds,
        lastCheckedAt: result.checkedAt,
        lastKrwCount: currentIds.length,
      }).catch(err => { result.dbSaveError = err.message; });
    }

    if (isFirstRun) result.note = "First run — baseline established, no alerts sent.";
  } catch (err) {
    result.ok = false;
    result.error = err.message;
  }

  return result;
}

// ─── Perps background scans ───────────────────────────────────────────────────

async function runClaudePerpsBackground(baseUrl) {
  if (!hasDatabase()) return { ok: true, skipped: true, reason: "No database." };
  try {
    const stored = await getRuntimeState("claudeperps");
    const state = stored.found && stored.state ? sanitizeClaudeState(stored.state) : defaultClaudeState();
    if (scannedRecently(state.lastScanAt)) return { ok: true, skipped: true, reason: "Scan is fresh." };
    const result = await runClaudePerps_Scan(state, { manual: false, baseUrl });
    const saved = await upsertRuntimeState("claudeperps", result.state);
    return { ok: true, updatedAt: saved.updatedAt, summary: result.summary };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function runEmaPerpsBackground(baseUrl) {
  if (!hasDatabase()) return { ok: true, skipped: true, reason: "No database." };
  try {
    const stored = await getRuntimeState("emaperps");
    const state = stored.found && stored.state ? sanitizeEmaState(stored.state) : defaultEmaState();
    if (scannedRecently(state.lastScanAt)) return { ok: true, skipped: true, reason: "Scan is fresh." };
    const result = await runEmaPerps_Scan(state, { manual: false, baseUrl });
    const saved = await upsertRuntimeState("emaperps", result.state);
    return { ok: true, updatedAt: saved.updatedAt, summary: result.summary };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return buildJsonResponse(res, 405, { error: "Method not allowed." });
  }

  // Auth check — returns 401 on failure (intentional: wrong secret should fail loudly)
  try {
    requireAuthorized(req);
  } catch (err) {
    return buildJsonResponse(res, err.statusCode || 500, { error: err.message });
  }

  const baseUrl = getBaseUrl(req);
  const destinations = getDestinations();

  // Run everything concurrently; each piece is internally error-safe.
  const [upbitResult, claudeResult, emaResult] = await Promise.all([
    runUpbitMonitor(destinations),
    runClaudePerpsBackground(baseUrl),
    runEmaPerpsBackground(baseUrl),
  ]);

  // Always 200 — errors are visible in the JSON body, not the HTTP status.
  buildJsonResponse(res, 200, {
    ok: true,
    runAt: new Date().toISOString(),
    upbit: upbitResult,
    claudeperps: claudeResult,
    emaperps: emaResult,
  });
};
