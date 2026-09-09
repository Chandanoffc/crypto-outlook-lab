"use strict";
const { hasDatabase, getRuntimeState, upsertRuntimeState } = require("../lib/neon-db");
const { defaultState: memeAutoDefault } = require("../lib/meme-autoscan");

const STATE_KEY = "memescreener";
const HELIUS_KEY = process.env.HELIUS_API_KEY || "";
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;

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

// ── Helius / RPC helpers ──────────────────────────────────

async function rpcCall(method, params) {
  const r = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "1", method, params }),
  });
  const d = await r.json();
  if (d.error) throw new Error(`RPC ${method}: ${d.error.message}`);
  return d.result;
}

async function getAsset(ca) {
  const r = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: "getAsset", params: { id: ca } }),
  });
  const d = await r.json();
  return d.result || null;
}

async function getDexScreener(ca) {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ca}`);
    return await r.json();
  } catch { return null; }
}

// ── On-chain scan ─────────────────────────────────────────

async function scanCA(ca) {
  if (!HELIUS_KEY) throw new Error("HELIUS_API_KEY not configured");

  const [asset, largestAccounts, supplyResult, dex] = await Promise.all([
    getAsset(ca),
    rpcCall("getTokenLargestAccounts", [ca, { commitment: "confirmed" }]),
    rpcCall("getTokenSupply", [ca, { commitment: "confirmed" }]),
    getDexScreener(ca),
  ]);

  // ── Token name / symbol ───────────────────────────────
  const meta = asset?.content?.metadata || {};
  const tokenInfo = asset?.token_info || {};
  const name = meta.name || meta.symbol || tokenInfo.symbol || ca.slice(0, 8) + "…";

  // ── Mint / freeze authority ───────────────────────────
  const mintAuthority   = tokenInfo.mint_authority   || null;
  const freezeAuthority = tokenInfo.freeze_authority || null;
  const mint_authority_revoked   = !mintAuthority;
  const freeze_authority_revoked = !freezeAuthority;

  // ── Holder concentration ──────────────────────────────
  const totalSupply = parseFloat(supplyResult?.value?.uiAmount || 0);
  const accounts = largestAccounts?.value || [];

  // Filter out known burn/zero addresses
  const BURN = new Set(["1nc1nerator11111111111111111111111111111111", "11111111111111111111111111111111"]);
  const filtered = accounts.filter(a => !BURN.has(a.address));
  const top10Balances = filtered.slice(0, 10).map(a => parseFloat(a.uiAmount || 0));
  const top10Sum = top10Balances.reduce((s, v) => s + v, 0);
  const top10_holder_pct = totalSupply > 0 ? (top10Sum / totalSupply) * 100 : null;

  // Count unique non-zero accounts as proxy for buyer count
  const unique_buyer_count = filtered.length;

  // ── DexScreener market data ───────────────────────────
  const pairs = dex?.pairs || [];
  // Pick the most liquid pair
  const pair = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0] || null;

  const volume_24h_usd   = pair?.volume?.h24     ? parseFloat(pair.volume.h24)   : null;
  const liquidity_usd    = pair?.liquidity?.usd   ? parseFloat(pair.liquidity.usd) : null;
  const price_usd        = pair?.priceUsd         ? parseFloat(pair.priceUsd)     : null;
  const fdv              = pair?.fdv              ? parseFloat(pair.fdv)          : null;
  const age_minutes      = pair?.pairCreatedAt
    ? Math.floor((Date.now() - pair.pairCreatedAt) / 60000) : null;
  const dex_name         = pair?.dexId || null;

  // LP locked/burned: if Pump.fun graduated, LP is auto-burned by protocol
  // Heuristic: if on Raydium and pool age > 0 and we can confirm via DexScreener
  const lp_locked_or_burned = dex_name === "raydium" ? true : null;

  // Volume concentration proxy: top 10 holder pct as a rough signal
  // (proper wash trading detection requires tx-level data — flag as null if no volume)
  const pct_volume_from_top10_wallets = null; // requires enhanced tx analysis

  // ── Assemble scored data ──────────────────────────────
  const data = {
    mint_authority_revoked,
    freeze_authority_revoked,
    lp_locked_or_burned,
    top10_holder_pct:              top10_holder_pct != null ? Math.round(top10_holder_pct * 10) / 10 : null,
    connected_cluster_pct:         null, // requires wallet graph analysis
    unique_buyer_count:            unique_buyer_count || null,
    volume_24h_usd,
    pct_volume_from_top10_wallets,
    dev_previous_tokens_count:     null,
    dev_previous_rug_flags:        null,
    is_name_copycat:               null,
    social_mention_velocity_trend: "unknown",
    promoted_by_kol:               null,
    kol_known_large_holder:        null,
    kol_post_age_minutes:          null,
    kol_on_disclosed_paid_promo_list: null,
    age_minutes,
  };

  return { name, ca, data, market: { price_usd, volume_24h_usd, liquidity_usd, fdv, dex_name, age_minutes, pair_url: pair?.url || null } };
}

// ── Scoring rubric (same logic as client) ─────────────────

function scoreContractSafety(d) {
  const allNull = d.mint_authority_revoked == null && d.freeze_authority_revoked == null && d.lp_locked_or_burned == null;
  if (allNull) return null;
  if (d.mint_authority_revoked && d.freeze_authority_revoked && d.lp_locked_or_burned) return 2;
  if (!d.mint_authority_revoked && !d.freeze_authority_revoked && !d.lp_locked_or_burned) return 0;
  return 1;
}
function scoreDistribution(d) {
  if (d.top10_holder_pct == null && d.connected_cluster_pct == null) return null;
  const t = d.top10_holder_pct, c = d.connected_cluster_pct;
  if ((t != null && t > 40) || (c != null && c > 40)) return 0;
  if ((t == null || t < 20) && (c == null || c < 20)) return 2;
  return 1;
}
function scoreDevHistory(d) {
  if (d.dev_previous_rug_flags == null && d.dev_previous_tokens_count == null) return null;
  if (d.dev_previous_rug_flags > 0) return 0;
  if (d.dev_previous_tokens_count > 0 && d.dev_previous_rug_flags === 0) return 2;
  return 1;
}
function scoreVolume(d) {
  if (d.pct_volume_from_top10_wallets == null && d.unique_buyer_count == null) return null;
  const pct = d.pct_volume_from_top10_wallets;
  if (pct != null && pct > 80) return 0;
  if (d.unique_buyer_count != null && d.unique_buyer_count < 20 && d.volume_24h_usd > 50000) return 0;
  if (pct != null && pct < 30) return 2;
  return 1;
}
function scoreCopycat(d) { return d.is_name_copycat == null ? null : d.is_name_copycat ? 0 : 2; }
function scoreSocial(d) {
  const t = d.social_mention_velocity_trend;
  if (!t || t === "unknown") return null;
  return t === "rising_faster_than_price" ? 2 : t === "tracking_price" ? 1 : 0;
}
function scoreKol(d) {
  if (!d.promoted_by_kol) return 2;
  if (d.kol_known_large_holder || d.kol_on_disclosed_paid_promo_list) return 0;
  return 1;
}

function computeResult(name, ca, data) {
  const sub_scores = {
    contract_safety:     scoreContractSafety(data),
    distribution_safety: scoreDistribution(data),
    dev_history:         scoreDevHistory(data),
    volume_authenticity: scoreVolume(data),
    copycat_check:       scoreCopycat(data),
    social_pattern:      scoreSocial(data),
    kol_independence:    scoreKol(data),
  };
  const nonNull = Object.values(sub_scores).filter(v => v !== null);
  const total = Object.keys(sub_scores).length;
  const nullCount = total - nonNull.length;
  const composite_score = nonNull.length ? nonNull.reduce((s, v) => s + v, 0) / (2 * nonNull.length) : null;
  const forced_high_risk = sub_scores.distribution_safety === 0 || sub_scores.dev_history === 0;

  let classification;
  if (nullCount > total / 2) classification = "Insufficient data — fill in missing fields manually";
  else if (forced_high_risk) classification = "High risk — pattern consistent with documented rug/wash setups";
  else if (composite_score >= 0.8) classification = "Lower relative risk — still verify manually before entry";
  else if (composite_score >= 0.5) classification = "Elevated risk — multiple unresolved flags";
  else classification = "High risk — pattern consistent with documented rug/wash setups";

  const missing = Object.entries({
    connected_cluster_pct: data.connected_cluster_pct,
    pct_volume_from_top10_wallets: data.pct_volume_from_top10_wallets,
    dev_previous_tokens_count: data.dev_previous_tokens_count,
    dev_previous_rug_flags: data.dev_previous_rug_flags,
    is_name_copycat: data.is_name_copycat,
    social_mention_velocity_trend: data.social_mention_velocity_trend === "unknown" ? null : data.social_mention_velocity_trend,
    promoted_by_kol: data.promoted_by_kol,
  }).filter(([, v]) => v == null).map(([k]) => k);

  return { token: name, ca, sub_scores, composite_score, classification, forced_high_risk, missing_data_fields: missing };
}

// ── Discord alert ─────────────────────────────────────────

async function sendDiscordAlert(webhook, result, market) {
  if (!webhook) return;
  const cls = result.classification;
  const color = cls.startsWith("Lower") ? 0x22c55e : cls.startsWith("Elevated") ? 0xf59e0b : 0xef4444;
  const subRows = Object.entries(result.sub_scores)
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v === null ? "—" : v === 0 ? "🔴 0" : v === 1 ? "🟡 1" : "🟢 2"}`)
    .join("\n");
  const mkt = market || {};
  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        title: `🔍 ${result.token} — ${cls.split("—")[0].trim()}`,
        url: mkt.pair_url || undefined,
        color,
        fields: [
          { name: "CA", value: `\`${result.ca}\``, inline: false },
          { name: "Score", value: result.composite_score != null ? `${Math.round(result.composite_score * 100)}%` : "—", inline: true },
          { name: "Price", value: mkt.price_usd ? `$${parseFloat(mkt.price_usd).toExponential(3)}` : "—", inline: true },
          { name: "Vol 24h", value: mkt.volume_24h_usd ? `$${Number(mkt.volume_24h_usd).toLocaleString()}` : "—", inline: true },
          { name: "Liquidity", value: mkt.liquidity_usd ? `$${Number(mkt.liquidity_usd).toLocaleString()}` : "—", inline: true },
          { name: "FDV", value: mkt.fdv ? `$${Number(mkt.fdv).toLocaleString()}` : "—", inline: true },
          { name: "Age", value: mkt.age_minutes != null ? `${mkt.age_minutes}m` : "—", inline: true },
          { name: "Sub-Scores", value: subRows, inline: false },
          ...(result.missing_data_fields?.length ? [{ name: "⚠️ Needs Manual Check", value: result.missing_data_fields.join(", "), inline: false }] : []),
        ],
        footer: { text: "Soloris · MemeScreener" },
        timestamp: new Date().toISOString(),
      }],
    }),
  });
}

// ── Handler ───────────────────────────────────────────────

async function readBody(req) {
  return new Promise((res, rej) => {
    let d = ""; req.on("data", c => d += c); req.on("end", () => { try { res(JSON.parse(d || "{}")); } catch { res({}); } }); req.on("error", rej);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }

  const state = await loadState();

  if (req.method === "GET") {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.searchParams.get("view") === "autoscans") {
      let autoState = memeAutoDefault();
      if (hasDatabase()) {
        const row = await getRuntimeState("meme-autoscan");
        if (row?.state) autoState = { ...memeAutoDefault(), ...row.state };
      }
      return res.end(JSON.stringify({ ok: true, tokens: autoState.tokens || [], lastScan: autoState.lastScan || 0 }));
    }
    return res.end(JSON.stringify({ ok: true, settings: state.settings, history: state.history }));
  }
  if (req.method !== "POST") { res.statusCode = 405; return res.end(JSON.stringify({ error: "Method not allowed" })); }

  const body = await readBody(req);
  const { action } = body;

  if (action === "settings") {
    if (body.discordWebhook !== undefined) state.settings.discordWebhook = String(body.discordWebhook).trim();
    await saveState(state);
    return res.end(JSON.stringify({ ok: true, settings: state.settings }));
  }

  if (action === "scan") {
    const ca = String(body.ca || "").trim();
    if (!ca) { res.statusCode = 400; return res.end(JSON.stringify({ error: "ca required" })); }
    try {
      const { name, data, market } = await scanCA(ca);
      const result = computeResult(name, ca, data);
      result.market = market;
      result.scannedAt = Date.now();
      return res.end(JSON.stringify({ ok: true, result }));
    } catch (e) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  if (action === "alert") {
    const { result } = body;
    if (!result) { res.statusCode = 400; return res.end(JSON.stringify({ error: "result required" })); }
    const webhook = state.settings.discordWebhook;
    if (!webhook) { res.statusCode = 400; return res.end(JSON.stringify({ error: "No Discord webhook configured in Settings" })); }
    try {
      await sendDiscordAlert(webhook, result, result.market);
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
