"use strict";
const { hasDatabase, getRuntimeState, upsertRuntimeState } = require("../lib/neon-db");

const STATE_KEY = "memescreener";
function defaultState() { return { settings: { discordWebhook: "" }, history: [] }; }

async function loadState() {
  if (!hasDatabase()) return defaultState();
  try {
    const row = await getRuntimeState(STATE_KEY);
    return row?.state ? { ...defaultState(), ...row.state } : defaultState();
  } catch { return defaultState(); }
}

async function saveState(state) {
  if (!hasDatabase()) return;
  await upsertRuntimeState(STATE_KEY, state);
}

async function sendDiscordAlert(webhook, result) {
  if (!webhook) return;
  const cls = result.classification;
  const color = cls.startsWith("Lower") ? 0x22c55e : cls.startsWith("Elevated") ? 0xf59e0b : 0xef4444;
  const subRows = Object.entries(result.sub_scores)
    .map(([k, v]) => `${k.replace(/_/g," ")}: ${v === null ? "—" : v === 0 ? "🔴 0" : v === 1 ? "🟡 1" : "🟢 2"}`)
    .join("\n");

  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        title: `🔍 Memecoin Screen — ${result.token}`,
        color,
        fields: [
          { name: "Classification", value: cls, inline: false },
          { name: "Composite Score", value: `${(result.composite_score * 100).toFixed(0)}%`, inline: true },
          { name: "Forced High Risk", value: result.forced_high_risk ? "⚠️ Yes" : "No", inline: true },
          { name: "Sub-Scores", value: subRows || "—", inline: false },
          { name: "Summary", value: result.summary.slice(0, 900), inline: false },
          ...(result.missing_data_fields?.length ? [{ name: "Missing Fields", value: result.missing_data_fields.join(", "), inline: false }] : []),
        ],
        footer: { text: "Soloris · Memecoin Screener" },
        timestamp: new Date().toISOString(),
      }],
    }),
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }

  const state = await loadState();

  if (req.method === "GET") {
    return res.end(JSON.stringify({ ok: true, settings: state.settings, history: state.history }));
  }

  if (req.method !== "POST") { res.statusCode = 405; return res.end(JSON.stringify({ error: "Method not allowed" })); }

  let body = {};
  try {
    const raw = await new Promise((res, rej) => {
      let d = ""; req.on("data", c => d += c); req.on("end", () => res(d)); req.on("error", rej);
    });
    body = JSON.parse(raw || "{}");
  } catch { res.statusCode = 400; return res.end(JSON.stringify({ error: "Invalid JSON" })); }

  const { action } = body;

  if (action === "settings") {
    if (body.discordWebhook !== undefined) state.settings.discordWebhook = String(body.discordWebhook).trim();
    await saveState(state);
    return res.end(JSON.stringify({ ok: true, settings: state.settings }));
  }

  if (action === "alert") {
    const result = body.result;
    if (!result) { res.statusCode = 400; return res.end(JSON.stringify({ error: "result required" })); }
    const webhook = state.settings.discordWebhook;
    if (!webhook) { res.statusCode = 400; return res.end(JSON.stringify({ error: "No Discord webhook configured" })); }
    try {
      await sendDiscordAlert(webhook, result);
      // Save to history (last 50)
      state.history = [{ ...result, alertedAt: Date.now() }, ...state.history].slice(0, 50);
      await saveState(state);
      return res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  res.statusCode = 400;
  res.end(JSON.stringify({ error: "Unknown action" }));
};
