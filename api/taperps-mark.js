"use strict";
/**
 * taperps-mark.js — runs every 2 minutes via cron-job.org.
 *
 * Marks open TA Perps paper positions: fetches live prices from Binance,
 * fires SL / TP1 / TP2 / expiry closes, sends Discord alerts on close events.
 *
 * Uses a separate lock row ("taperps-mark-lock") so it never clobbers the
 * scan state written by taperps-scan.js ("taperps" row).
 */
const { hasDatabase, getRuntimeState, upsertRuntimeState, tryClaimMarkLock } = require("../lib/neon-db");
const { markTAPaperPositions, defaultState, defaultPaper } = require("../lib/taperps-scanner");

function buildJsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return buildJsonResponse(res, 405, { error: "GET only" });

  try {
    const now = Date.now();

    let state = defaultState();
    if (hasDatabase()) {
      const row = await getRuntimeState("taperps");
      if (row?.state) state = { ...defaultState(), ...row.state };
    }
    // Always ensure paper is present — may be missing from older DB rows
    if (!state.paper) state.paper = defaultPaper();

    const msRow   = hasDatabase() ? await getRuntimeState("memescreener") : null;
    const webhook = msRow?.state?.settings?.discordWebhook || "";

    // 90s cooldown — mark runs every 2 min, cooldown prevents double-fires
    const claimed = await tryClaimMarkLock("taperps-mark-lock", now, 90 * 1000);
    let marked = 0;
    if (claimed) {
      const before = state.paper.openPositions.length;
      await markTAPaperPositions(state.paper, now, webhook);
      marked = before - state.paper.openPositions.length;
      if (hasDatabase()) await upsertRuntimeState("taperps", state);
    }

    return buildJsonResponse(res, 200, {
      ok: true,
      skipped: !claimed,
      marked,
      openPositions: state.paper.openPositions.length,
      balance: state.paper.balance,
    });
  } catch (err) {
    return buildJsonResponse(res, 500, { ok: false, error: err.message });
  }
};
