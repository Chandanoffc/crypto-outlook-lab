"use strict";

/**
 * api/backtest.js — on-demand historical replay for claudeperps / emaperps.
 *
 * GET  /api/backtest?engine=claudeperps&days=60&symbols=BTCUSDT,ETHUSDT
 * POST /api/backtest  { engine, days, symbols, stepHours, startingBalance }
 *
 * Runs lib/backtest-runtime.js#runBacktest, which replays the *exact* live
 * detectSignal/sizing/exit logic against historical Binance klines and
 * returns win-rate / profit-factor / drawdown statistics. Read-only — no
 * state is persisted; this is an analysis tool, not a background job.
 *
 * Kept unauthenticated (like /api/market) since it only reads public market
 * data and runs in-memory; Vercel's function timeout bounds the blast radius.
 */

const { runBacktest } = require("../lib/backtest-runtime");

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

function parseSymbols(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return undefined;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return buildJsonResponse(res, 405, { error: "Method not allowed." });
  }

  try {
    let params;
    if (req.method === "GET") {
      const q = req.query || {};
      params = {
        engine: q.engine,
        days: q.days !== undefined ? Number(q.days) : undefined,
        stepHours: q.stepHours !== undefined ? Number(q.stepHours) : undefined,
        startingBalance: q.startingBalance !== undefined ? Number(q.startingBalance) : undefined,
        symbols: parseSymbols(q.symbols),
      };
    } else {
      const body = await readJsonBody(req);
      params = {
        engine: body.engine,
        days: body.days,
        stepHours: body.stepHours,
        startingBalance: body.startingBalance,
        symbols: parseSymbols(body.symbols),
      };
    }

    const result = await runBacktest(params);
    return buildJsonResponse(res, 200, { ok: true, result });
  } catch (err) {
    return buildJsonResponse(res, 500, { ok: false, error: err.message || "Backtest failed." });
  }
};
