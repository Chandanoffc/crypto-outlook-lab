"use strict";
/**
 * taperps.js — unified TA Perps endpoint (consolidates taperps-scan + taperps-mark).
 *
 * GET                          → state (settings, signals, paper)
 * GET ?action=scan[&manual=1]  → run signal scan
 * GET ?action=mark             → mark open paper positions (called every 2 min)
 * POST { action:"settings", discordWebhook:"..." } → save settings
 */
const { hasDatabase, getRuntimeState, upsertRuntimeState, tryClaimScanLock, tryClaimMarkLock } = require("../lib/neon-db");
const { runTAPerps_Scan, markTAPaperPositions, defaultState, defaultPaper } = require("../lib/taperps-scanner");

function buildJsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function loadState() {
  let state = defaultState();
  if (hasDatabase()) {
    const row = await getRuntimeState("taperps");
    if (row?.state) state = { ...defaultState(), ...row.state };
  }
  if (!state.settings) state.settings = { discordWebhook: "" };
  if (!state.paper)    state.paper    = defaultPaper();
  return state;
}

module.exports = async function handler(req, res) {
  // ── POST: save settings ────────────────────────────────────────────────────
  if (req.method === "POST") {
    let body = {};
    try {
      const chunks = [];
      await new Promise((resolve, reject) => {
        req.on("data", c => chunks.push(c));
        req.on("end", resolve);
        req.on("error", reject);
      });
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch (_) {}

    if (body.action === "settings") {
      const state = await loadState();
      if (body.discordWebhook !== undefined)
        state.settings.discordWebhook = String(body.discordWebhook).trim();
      if (hasDatabase()) await upsertRuntimeState("taperps", state);
      return buildJsonResponse(res, 200, { ok: true, settings: state.settings });
    }
    return buildJsonResponse(res, 400, { error: "Unknown action" });
  }

  if (req.method !== "GET") return buildJsonResponse(res, 405, { error: "Method not allowed" });

  const action = req.query?.action;
  const now    = Date.now();

  // ── GET ?action=scan ───────────────────────────────────────────────────────
  if (action === "scan") {
    const manual   = req.query?.manual === "1" || req.query?.manual === "true";
    const state    = await loadState();
    const webhook  = state.settings.discordWebhook || "";
    const cooldown = manual ? 0 : 55 * 60 * 1000;
    const claimed  = await tryClaimScanLock("taperps-lock", now, cooldown);
    let summary    = null;
    if (claimed) {
      summary = await runTAPerps_Scan(state, { webhook });
      if (hasDatabase()) await upsertRuntimeState("taperps", state);
    }
    return buildJsonResponse(res, 200, {
      ok: true, skipped: !claimed, summary,
      signals: state.signals ?? [], paper: state.paper ?? null, lastScan: state.lastScan ?? null,
    });
  }

  // ── GET ?action=mark ───────────────────────────────────────────────────────
  if (action === "mark") {
    const state   = await loadState();
    const webhook = state.settings.discordWebhook || "";
    const claimed = await tryClaimMarkLock("taperps-mark-lock", now, 90 * 1000);
    let marked    = 0;
    if (claimed) {
      const before = state.paper.openPositions.length;
      await markTAPaperPositions(state.paper, now, webhook);
      marked = before - state.paper.openPositions.length;
      if (hasDatabase()) await upsertRuntimeState("taperps", state);
    }
    return buildJsonResponse(res, 200, {
      ok: true, skipped: !claimed, marked,
      openPositions: state.paper.openPositions.length, balance: state.paper.balance,
    });
  }

  // ── GET (no action): state read ────────────────────────────────────────────
  const state = await loadState();
  return buildJsonResponse(res, 200, {
    ok: true, settings: state.settings,
    signals: state.signals ?? [], paper: state.paper ?? null, lastScan: state.lastScan ?? null,
  });
};
