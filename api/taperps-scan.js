"use strict";
/**
 * taperps-scan.js — manual trigger endpoint for TA Perps scanner.
 * Called by cron-scan.js (hourly) and the frontend's "Scan Now" button.
 */
const { hasDatabase, getRuntimeState, upsertRuntimeState, tryClaimScanLock } = require("../lib/neon-db");
const { runTAPerps_Scan, defaultState, defaultPaper } = require("../lib/taperps-scanner");

function buildJsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return buildJsonResponse(res, 405, { error: "GET only" });

  try {
    const now    = Date.now();
    const manual = req.query?.manual === "1" || req.query?.manual === "true";

    let state = defaultState();
    if (hasDatabase()) {
      const row = await getRuntimeState("taperps");
      if (row?.state) state = { ...defaultState(), ...row.state };
    }
    // Always ensure settings and paper are present — may be missing from older DB rows
    if (!state.settings) state.settings = { discordWebhook: "" };
    if (!state.paper) state.paper = defaultPaper();

    const webhook = state.settings.discordWebhook || "";

    // Claim scan lock — 55-min cooldown for cron, no cooldown for manual
    const cooldown = manual ? 0 : 55 * 60 * 1000;
    const claimed  = await tryClaimScanLock("taperps-lock", now, cooldown);

    let summary = null;
    if (claimed) {
      summary = await runTAPerps_Scan(state, { webhook });
      if (hasDatabase()) await upsertRuntimeState("taperps", state);
    }

    return buildJsonResponse(res, 200, {
      ok:       true,
      skipped:  !claimed,
      summary,
      signals:  state.signals ?? [],
      paper:    state.paper ?? null,
      lastScan: state.lastScan ?? null,
    });
  } catch (err) {
    return buildJsonResponse(res, 500, { ok: false, error: err.message });
  }
};
