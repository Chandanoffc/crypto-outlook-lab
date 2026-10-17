"use strict";
/**
 * taperps.js — state/settings endpoint for TA Perps.
 * GET  → returns current state (settings, signals, paper)
 * POST { action: "settings", discordWebhook: "..." } → saves webhook
 */
const { hasDatabase, getRuntimeState, upsertRuntimeState } = require("../lib/neon-db");
const { defaultState, defaultPaper } = require("../lib/taperps-scanner");

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
  if (req.method === "GET") {
    const state = await loadState();
    return buildJsonResponse(res, 200, {
      ok:       true,
      settings: state.settings,
      signals:  state.signals  ?? [],
      paper:    state.paper    ?? null,
      lastScan: state.lastScan ?? null,
    });
  }

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
      if (body.discordWebhook !== undefined) {
        state.settings.discordWebhook = String(body.discordWebhook).trim();
      }
      if (hasDatabase()) await upsertRuntimeState("taperps", state);
      return buildJsonResponse(res, 200, { ok: true, settings: state.settings });
    }

    return buildJsonResponse(res, 400, { error: "Unknown action" });
  }

  return buildJsonResponse(res, 405, { error: "Method not allowed" });
};
