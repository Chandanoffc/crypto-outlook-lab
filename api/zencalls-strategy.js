"use strict";
const { hasDatabase, getRuntimeState } = require("../lib/neon-db");

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "GET") { res.statusCode = 405; return res.end(JSON.stringify({ error: "Method not allowed" })); }

  try {
    const row = hasDatabase() ? await getRuntimeState("zencalls-strategy") : null;
    const state = row?.state || { signals: [], lastScan: 0 };
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, signals: state.signals || [], lastScan: state.lastScan || 0 }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
};
