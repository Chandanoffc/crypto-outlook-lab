"use strict";
/**
 * zencalls.js — API for ZenCalls: manually curated conviction trade calls.
 * Calls are stored as a JSON array in runtime_states under key "zencalls".
 *
 * Actions:
 *   GET             → list all calls
 *   POST action=add → add a new call (fires Discord alert if webhook configured)
 *   POST action=update → update status of a call (tp1/tp2/sl/closed)
 *   POST action=delete → remove a call by id
 *   POST action=settings → update Discord webhook
 */
const crypto = require("crypto");
const { hasDatabase, getRuntimeState, upsertRuntimeState } = require("../lib/neon-db");

const ENGINE_KEY = "zencalls";

function buildJsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function inferBaseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.headers.host || "soloris-signals.vercel.app";
  return `${proto}://${host}`;
}

function defaultState() {
  return {
    calls: [],
    settings: { discordWebhook: "", notifyOnNew: true },
  };
}

async function loadState() {
  if (!hasDatabase()) return { available: false, state: defaultState() };
  try {
    const row = await getRuntimeState(ENGINE_KEY);
    if (row && row.state) {
      const s = row.state;
      return {
        available: true,
        state: {
          calls: Array.isArray(s.calls) ? s.calls : [],
          settings: { discordWebhook: "", notifyOnNew: true, ...(s.settings || {}) },
        },
      };
    }
    const seed = defaultState();
    await upsertRuntimeState(ENGINE_KEY, seed);
    return { available: true, state: seed };
  } catch (_) {
    return { available: false, state: defaultState() };
  }
}

async function sendDiscordAlert(webhook, call) {
  if (!webhook) return;
  const sideEmoji = call.side === "long" ? "🟢" : "🔴";
  const tpLines = [
    call.tp1 != null ? `TP1  ${call.tp1}` : null,
    call.tp2 != null ? `TP2  ${call.tp2}` : null,
  ].filter(Boolean).join("\n");
  const slLine = call.sl != null ? `SL   ${call.sl}` : "";
  const embed = {
    title: `${sideEmoji} ZenCall · ${call.symbol} ${call.side.toUpperCase()} · ${call.timeframe}`,
    color: call.side === "long" ? 0x22c55e : 0xef4444,
    fields: [
      { name: "Pattern", value: call.pattern || "—", inline: false },
      { name: "Entry", value: String(call.entry), inline: true },
      { name: "Levels", value: [tpLines, slLine].filter(Boolean).join("\n") || "—", inline: true },
      ...(call.note ? [{ name: "Note", value: call.note.slice(0, 300), inline: false }] : []),
    ],
    timestamp: new Date().toISOString(),
    footer: { text: "Soloris · ZenCalls" },
  };
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch (_) {}
}

async function sendStatusAlert(webhook, call, newStatus) {
  if (!webhook) return;
  const labels = { tp1: "TP1 Hit ✅", tp2: "TP2 Hit 🎯", sl: "SL Hit ❌", closed: "Closed 📋" };
  const label = labels[newStatus] || newStatus;
  const embed = {
    title: `ZenCall ${label} · ${call.symbol} ${call.side.toUpperCase()}`,
    color: ["tp1","tp2"].includes(newStatus) ? 0x22c55e : newStatus === "sl" ? 0xef4444 : 0x6b7280,
    fields: [
      { name: "Pattern", value: call.pattern || "—", inline: false },
      { name: "Entry", value: String(call.entry), inline: true },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: "Soloris · ZenCalls" },
  };
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch (_) {}
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return buildJsonResponse(res, 405, { error: "Method not allowed." });
  }

  try {
    if (req.method === "GET") {
      const { available, state } = await loadState();
      return buildJsonResponse(res, 200, { ok: true, available, calls: state.calls, settings: state.settings });
    }

    const body = await readJsonBody(req);
    const action = String(body?.action || "").trim().toLowerCase();

    if (action === "add") {
      const { available, state } = await loadState();
      const call = {
        id: crypto.randomUUID(),
        symbol: String(body.symbol || "").trim().toUpperCase(),
        side: body.side === "short" ? "short" : "long",
        timeframe: String(body.timeframe || "").trim() || "4h",
        pattern: String(body.pattern || "").trim().slice(0, 120),
        entry: body.entry != null ? Number(body.entry) : null,
        tp1: body.tp1 != null ? Number(body.tp1) : null,
        tp2: body.tp2 != null ? Number(body.tp2) : null,
        sl: body.sl != null ? Number(body.sl) : null,
        note: String(body.note || "").trim().slice(0, 400),
        status: "open",
        createdAt: Date.now(),
        closedAt: null,
      };
      if (!call.symbol) return buildJsonResponse(res, 400, { ok: false, error: "symbol required" });
      state.calls.unshift(call);
      if (hasDatabase()) await upsertRuntimeState(ENGINE_KEY, state);
      if (state.settings.notifyOnNew) {
        await sendDiscordAlert(state.settings.discordWebhook, call);
      }
      return buildJsonResponse(res, 200, { ok: true, call, calls: state.calls });
    }

    if (action === "update") {
      const { available, state } = await loadState();
      const id = String(body.id || "").trim();
      const idx = state.calls.findIndex(c => c.id === id);
      if (idx === -1) return buildJsonResponse(res, 404, { ok: false, error: "call not found" });
      const newStatus = String(body.status || state.calls[idx].status);
      const prev = state.calls[idx];
      state.calls[idx] = {
        ...prev,
        status: newStatus,
        closedAt: ["tp1","tp2","sl","closed"].includes(newStatus) && !prev.closedAt ? Date.now() : prev.closedAt,
        ...(body.note !== undefined ? { note: String(body.note).slice(0, 400) } : {}),
      };
      if (hasDatabase()) await upsertRuntimeState(ENGINE_KEY, state);
      if (["tp1","tp2","sl"].includes(newStatus) && state.settings.discordWebhook) {
        await sendStatusAlert(state.settings.discordWebhook, state.calls[idx], newStatus);
      }
      return buildJsonResponse(res, 200, { ok: true, call: state.calls[idx], calls: state.calls });
    }

    if (action === "delete") {
      const { available, state } = await loadState();
      const id = String(body.id || "").trim();
      const before = state.calls.length;
      state.calls = state.calls.filter(c => c.id !== id);
      if (state.calls.length === before) return buildJsonResponse(res, 404, { ok: false, error: "call not found" });
      if (hasDatabase()) await upsertRuntimeState(ENGINE_KEY, state);
      return buildJsonResponse(res, 200, { ok: true, calls: state.calls });
    }

    if (action === "settings") {
      const { available, state } = await loadState();
      if (body.discordWebhook !== undefined) state.settings.discordWebhook = String(body.discordWebhook).trim();
      if (body.notifyOnNew !== undefined) state.settings.notifyOnNew = Boolean(body.notifyOnNew);
      if (hasDatabase()) await upsertRuntimeState(ENGINE_KEY, state);
      return buildJsonResponse(res, 200, { ok: true, settings: state.settings });
    }

    return buildJsonResponse(res, 400, { error: "Unknown action." });
  } catch (err) {
    return buildJsonResponse(res, 500, { error: err.message || "Internal error." });
  }
};
