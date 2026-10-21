"use strict";
/**
 * breakout.js — Accumulation Breakout strategy endpoint.
 *
 * GET                          → state (settings, signals, paper)
 * GET ?action=scan[&manual=1]  → run signal scan
 * GET ?action=mark             → mark open paper positions
 * POST { action:"settings", discordWebhook:"..." } → save settings
 */
const { hasDatabase, getRuntimeState, upsertRuntimeState, tryClaimScanLock, tryClaimMarkLock } = require("../lib/neon-db");
const { runBreakout_Scan, markBreakoutPaper, defaultState, defaultPaper } = require("../lib/breakout-scanner");

function buildJsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function loadState() {
  let state = defaultState();
  if (hasDatabase()) {
    const row = await getRuntimeState("breakout");
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
      if (hasDatabase()) await upsertRuntimeState("breakout", state);
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
    const cooldown = manual ? 0 : 20 * 60 * 60 * 1000; // 20h auto-cooldown (daily bars)
    const claimed  = await tryClaimScanLock("breakout-lock", now, cooldown);
    let summary    = null;
    if (claimed) {
      summary = await runBreakout_Scan(state, { webhook });
      if (hasDatabase()) await upsertRuntimeState("breakout", state);
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
    const claimed = await tryClaimMarkLock("breakout-mark-lock", now, 90 * 1000);
    let marked    = 0;
    if (claimed) {
      const before = state.paper.openPositions.length;
      await markBreakoutPaper(state.paper, now, webhook);
      marked = before - state.paper.openPositions.length;
      if (hasDatabase()) await upsertRuntimeState("breakout", state);
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
