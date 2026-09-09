"use strict";
/**
 * meme-autoscan.js
 * Scans Pump.fun graduates + DexScreener profiles for tokens matching our
 * "good runner" criteria, scores them via the existing 7-factor rubric,
 * and fires Discord alerts.
 *
 * Called from api/cron-scan.js on each cron tick.
 * State key: "meme-autoscan"
 * State shape: { alerts: { [mint]: timestamp }, tokens: [...], lastScan: 0 }
 */

const HELIUS_KEY = process.env.HELIUS_API_KEY || "";
const RPC_URL    = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;

const COOLDOWN_MS   = 6 * 60 * 60 * 1000;  // 6h per token
const MAX_AGE_MS    = 4 * 60 * 60 * 1000;  // only tokens < 4h since graduation
const MAX_TOKENS    = 100;                   // keep last N in state

// ── Runner thresholds ──────────────────────────────────────
const MIN_LIQUIDITY_USD   = 5_000;
const MAX_FDV_USD         = 2_000_000;
const MIN_VOLH1_LIQ_RATIO = 1.5;    // 1h volume / liquidity
const MAX_TOP10_PCT       = 40;
const MIN_SCORE_PCT       = 40;     // composite rubric ≥ 40% to alert

// ── Sources ────────────────────────────────────────────────

async function fetchPumpFunGraduates() {
  try {
    const url = "https://frontend-api-v3.pump.fun/coins?complete=true&sort=created_timestamp&order=DESC&limit=50&includeNsfw=false";
    const r = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

async function fetchDexProfiles() {
  try {
    const [profiles, boosts] = await Promise.all([
      fetch("https://api.dexscreener.com/token-profiles/latest/v1").then(r => r.json()).catch(() => ({ data: [] })),
      fetch("https://api.dexscreener.com/token-boosts/latest/v1").then(r => r.json()).catch(() => ({ data: [] })),
    ]);
    const mints = new Set();
    for (const item of [...(profiles.data || []), ...(boosts.data || [])]) {
      if (item.chainId === "solana" && item.tokenAddress) mints.add(item.tokenAddress);
    }
    return [...mints];
  } catch { return []; }
}

async function fetchDexPairs(mints) {
  if (!mints.length) return {};
  // DexScreener allows up to 30 addresses at once
  const chunks = [];
  for (let i = 0; i < mints.length; i += 30) chunks.push(mints.slice(i, i + 30));
  const map = {};
  for (const chunk of chunks) {
    try {
      const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`);
      const d = await r.json();
      for (const pair of (d.pairs || [])) {
        if (pair.chainId !== "solana") continue;
        const mint = pair.baseToken?.address;
        if (!mint) continue;
        // Keep highest-liquidity pair per token
        if (!map[mint] || (pair.liquidity?.usd || 0) > (map[mint].liquidity?.usd || 0)) {
          map[mint] = pair;
        }
      }
    } catch { /* continue */ }
  }
  return map;
}

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

async function fetchHeliusData(mint) {
  if (!HELIUS_KEY) return null;
  try {
    const [asset, largestAccounts, supplyResult] = await Promise.all([
      fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: "getAsset", params: { id: mint } }),
      }).then(r => r.json()).then(d => d.result || null).catch(() => null),
      rpcCall("getTokenLargestAccounts", [mint, { commitment: "confirmed" }]).catch(() => null),
      rpcCall("getTokenSupply", [mint, { commitment: "confirmed" }]).catch(() => null),
    ]);

    const tokenInfo = asset?.token_info || {};
    const mint_authority_revoked   = !tokenInfo.mint_authority;
    const freeze_authority_revoked = !tokenInfo.freeze_authority;

    const BURN = new Set(["1nc1nerator11111111111111111111111111111111", "11111111111111111111111111111111"]);
    const accounts = (largestAccounts?.value || []).filter(a => !BURN.has(a.address));
    const totalSupply = parseFloat(supplyResult?.value?.uiAmount || 0);
    const top10Sum = accounts.slice(0, 10).reduce((s, a) => s + parseFloat(a.uiAmount || 0), 0);
    const top10_holder_pct = totalSupply > 0 ? (top10Sum / totalSupply) * 100 : null;
    const unique_buyers = accounts.length;

    const name   = asset?.content?.metadata?.name   || asset?.content?.metadata?.symbol || tokenInfo.symbol || "";
    const symbol = asset?.content?.metadata?.symbol || tokenInfo.symbol || "";

    return { name, symbol, mint_authority_revoked, freeze_authority_revoked, top10_holder_pct, unique_buyers };
  } catch { return null; }
}

// ── Scoring (mirrors api/memescreener.js) ─────────────────

function scoreContractSafety(mint_revoked, freeze_revoked, lp_burned) {
  if (mint_revoked && freeze_revoked && lp_burned) return 2;
  if (!mint_revoked && !freeze_revoked) return 0;
  return 1;
}
function scoreDistribution(top10) {
  if (top10 == null) return null;
  if (top10 > MAX_TOP10_PCT) return 0;
  if (top10 < 20) return 2;
  return 1;
}
function scoreVolume(uniqueBuyers, vol24h) {
  if (uniqueBuyers == null) return null;
  if (uniqueBuyers < 20 && (vol24h || 0) > 50_000) return 0; // wash-trade signal
  if (uniqueBuyers >= 200) return 2;
  if (uniqueBuyers >= 50)  return 1;
  return null;
}
function computeScore({ mint_authority_revoked, freeze_authority_revoked, top10_holder_pct, unique_buyers, vol24h, lp_burned }) {
  const subs = {
    contract_safety:     scoreContractSafety(mint_authority_revoked, freeze_authority_revoked, lp_burned),
    distribution_safety: scoreDistribution(top10_holder_pct),
    volume_authenticity: scoreVolume(unique_buyers, vol24h),
  };
  const nonNull = Object.values(subs).filter(v => v !== null);
  const composite = nonNull.length ? nonNull.reduce((s, v) => s + v, 0) / (2 * nonNull.length) : null;
  const forced_high_risk = subs.distribution_safety === 0;
  return { sub_scores: subs, composite_score: composite, forced_high_risk };
}

// ── Runner quality filters ────────────────────────────────

function qualifies(pair, helius) {
  const liq  = pair.liquidity?.usd || 0;
  const volH1 = pair.volume?.h1   || 0;
  const fdv  = pair.fdv           || 0;

  if (liq < MIN_LIQUIDITY_USD)   return false;
  if (fdv > MAX_FDV_USD && fdv !== 0) return false;
  if (liq > 0 && volH1 / liq < MIN_VOLH1_LIQ_RATIO) return false;
  if (helius) {
    if (helius.top10_holder_pct != null && helius.top10_holder_pct > MAX_TOP10_PCT) return false;
    if (!helius.mint_authority_revoked) return false;
  }
  return true;
}

// ── Discord alert ─────────────────────────────────────────

async function sendAlert(webhook, token) {
  if (!webhook) return;
  const score = token.composite_score;
  const color = score == null ? 0x888888
    : score >= 0.7 ? 0x22c55e
    : score >= 0.5 ? 0xf59e0b
    : 0xef4444;

  const sym    = token.symbol || token.name || token.mint.slice(0, 8);
  const liq    = token.liquidity_usd ? `$${Number(token.liquidity_usd).toLocaleString()}` : "—";
  const vol1h  = token.vol_h1_usd    ? `$${Number(token.vol_h1_usd).toLocaleString()}`    : "—";
  const fdv    = token.fdv_usd       ? `$${Number(token.fdv_usd).toLocaleString()}`        : "—";
  const price  = token.price_usd     ? `$${parseFloat(token.price_usd).toExponential(3)}`  : "—";
  const age    = token.age_minutes   ? `${token.age_minutes}m` : "—";
  const top10  = token.top10_holder_pct != null ? `${token.top10_holder_pct.toFixed(1)}%` : "—";
  const buyers = token.unique_buyers != null ? String(token.unique_buyers) : "—";
  const ratio  = token.vol_liq_ratio ? token.vol_liq_ratio.toFixed(1) + "×" : "—";
  const scoreStr = score != null ? `${Math.round(score * 100)}%` : "—";
  const source = token.source === "pumpfun" ? "🎰 Pump.fun graduate" : "📡 DexScreener signal";

  const subRows = Object.entries(token.sub_scores || {})
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v === null ? "—" : v === 0 ? "🔴 0" : v === 1 ? "🟡 1" : "🟢 2"}`)
    .join("\n");

  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        title: `🚨 ${sym} — Auto Runner Alert`,
        url: token.pair_url || undefined,
        color,
        description: source,
        fields: [
          { name: "Mint CA",       value: `\`${token.mint}\``, inline: false },
          { name: "Score",         value: scoreStr,  inline: true },
          { name: "Price",         value: price,     inline: true },
          { name: "MC at Detection", value: fdv,     inline: true },
          { name: "Age",           value: age,       inline: true },
          { name: "Liquidity",     value: liq,       inline: true },
          { name: "Vol 1h",        value: vol1h,     inline: true },
          { name: "Vol/Liq",       value: ratio,     inline: true },
          { name: "Top 10 %",      value: top10,     inline: true },
          { name: "Buyers",        value: buyers,    inline: true },
          { name: "Sub-scores",    value: subRows,   inline: false },
        ],
        footer: { text: "Soloris · MemeScreener Auto-Scan" },
        timestamp: new Date().toISOString(),
      }],
    }),
  });
}

// ── Main scan ─────────────────────────────────────────────

function defaultState() { return { alerts: {}, tokens: [], lastScan: 0 }; }

async function runMemeAutoScan(state, { webhook } = {}) {
  const now = Date.now();
  const summary = { checked: 0, qualified: 0, alerted: 0, errors: [] };

  // Collect mints from all sources
  const mintSet = new Set();

  // 1. Pump.fun graduates (last 4 hours)
  const graduates = await fetchPumpFunGraduates();
  const freshGrads = graduates.filter(c => {
    if (!c.mint) return false;
    const age = now - (c.created_timestamp || 0);
    return age < MAX_AGE_MS;
  });
  for (const g of freshGrads) mintSet.add(g.mint);

  // 2. DexScreener profiles/boosts
  const dexMints = await fetchDexProfiles();
  for (const m of dexMints) mintSet.add(m);

  if (!mintSet.size) return summary;

  summary.checked = mintSet.size;
  const mints = [...mintSet];

  // Fetch DexScreener pair data for all mints at once
  const pairMap = await fetchDexPairs(mints);

  // Pre-filter by liquidity + FDV + vol/liq before expensive Helius calls
  const candidates = mints.filter(mint => {
    const pair = pairMap[mint];
    if (!pair) return false;
    const liq   = pair.liquidity?.usd || 0;
    const volH1 = pair.volume?.h1     || 0;
    const fdv   = pair.fdv             || 0;
    return liq >= MIN_LIQUIDITY_USD
      && (fdv === 0 || fdv <= MAX_FDV_USD)
      && (liq === 0 || volH1 / liq >= MIN_VOLH1_LIQ_RATIO);
  });

  // Fetch Helius data for candidates in batches of 5 (rate-limit friendly)
  const BATCH = 5;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const heliusResults = await Promise.all(batch.map(m => fetchHeliusData(m)));

    for (let j = 0; j < batch.length; j++) {
      const mint    = batch[j];
      const helius  = heliusResults[j];
      const pair    = pairMap[mint];

      const lp_burned = pair.dexId === "raydium" || pair.dexId === "pumpswap";
      const vol24h    = pair.volume?.h24    || 0;
      const vol1h     = pair.volume?.h1     || 0;
      const liq       = pair.liquidity?.usd || 0;

      if (!qualifies(pair, helius)) continue;

      const scoreData = {
        mint_authority_revoked:   helius?.mint_authority_revoked   ?? true,
        freeze_authority_revoked: helius?.freeze_authority_revoked ?? true,
        top10_holder_pct:         helius?.top10_holder_pct         ?? null,
        unique_buyers:            helius?.unique_buyers             ?? null,
        vol24h,
        lp_burned,
      };
      const { sub_scores, composite_score, forced_high_risk } = computeScore(scoreData);

      if (forced_high_risk) continue;
      if (composite_score != null && composite_score * 100 < MIN_SCORE_PCT) continue;

      summary.qualified++;

      // Cooldown check
      const lastAlerted = state.alerts?.[mint] || 0;
      if (now - lastAlerted < COOLDOWN_MS) continue;

      const gradEntry = freshGrads.find(g => g.mint === mint);
      const ageMs     = gradEntry?.created_timestamp ? now - gradEntry.created_timestamp : null;

      const detectedPrice = pair.priceUsd ? parseFloat(pair.priceUsd) : null;
      const detectedMC    = pair.fdv      ? parseFloat(pair.fdv)      : null;

      const token = {
        id: `${mint}_${now}`,
        mint,
        name:            helius?.name   || pair.baseToken?.name   || mint.slice(0, 8),
        symbol:          helius?.symbol || pair.baseToken?.symbol || "?",
        source:          gradEntry ? "pumpfun" : "dexscreener",
        price_usd:       detectedPrice,
        detected_price:  detectedPrice,   // baseline for milestone tracking
        detected_mc:     detectedMC,      // MC (FDV) at time of detection
        liquidity_usd:   liq,
        vol_h1_usd:      vol1h,
        vol_liq_ratio:   liq > 0 ? vol1h / liq : null,
        fdv_usd:         detectedMC,
        age_minutes:     ageMs != null ? Math.floor(ageMs / 60000) : null,
        top10_holder_pct: helius?.top10_holder_pct ?? null,
        unique_buyers:   helius?.unique_buyers ?? null,
        mint_authority_revoked:   scoreData.mint_authority_revoked,
        freeze_authority_revoked: scoreData.freeze_authority_revoked,
        lp_burned,
        pair_url:        pair.url || null,
        sub_scores,
        composite_score,
        detectedAt:      now,
        milestones_hit:  [],   // e.g. ["2x", "3x"]
      };

      // Save to state
      state.tokens = [token, ...(state.tokens || []).filter(t => t.mint !== mint)].slice(0, MAX_TOKENS);
      state.alerts = state.alerts || {};
      state.alerts[mint] = now;

      // Fire Discord
      try {
        await sendAlert(webhook, token);
        summary.alerted++;
      } catch (e) {
        summary.errors.push(e.message);
      }
    }
  }

  state.lastScan = now;

  // Prune old alert timestamps (> 24h) to keep state lean
  const cutoff = now - 24 * 60 * 60 * 1000;
  for (const [mint, ts] of Object.entries(state.alerts || {})) {
    if (ts < cutoff) delete state.alerts[mint];
  }

  return summary;
}

// ── Milestone tracker ─────────────────────────────────────

const MILESTONES = [2, 3, 4, 5, 10]; // multiples to track

async function sendMilestoneAlert(webhook, token, multiple, currentPrice, currentMC) {
  if (!webhook) return;
  const sym   = token.symbol || token.name || token.mint.slice(0, 8);
  const emoji = multiple >= 10 ? "🚀🚀🚀" : multiple >= 5 ? "🚀🚀" : multiple >= 3 ? "🔥" : "✅";
  const mc    = currentMC    ? `$${Number(currentMC).toLocaleString()}`          : "—";
  const mc0   = token.detected_mc ? `$${Number(token.detected_mc).toLocaleString()}` : "—";
  const cp    = currentPrice ? `$${parseFloat(currentPrice).toExponential(3)}`   : "—";
  const cp0   = token.detected_price ? `$${parseFloat(token.detected_price).toExponential(3)}` : "—";

  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        title: `${emoji} ${sym} hit ${multiple}x — MemeScreener Milestone`,
        url: token.pair_url || undefined,
        color: multiple >= 5 ? 0xa78bfa : multiple >= 3 ? 0xf59e0b : 0x22c55e,
        fields: [
          { name: "Mint CA",          value: `\`${token.mint}\``, inline: false },
          { name: "Milestone",        value: `${multiple}x from detection`, inline: true },
          { name: "Current Price",    value: cp,   inline: true },
          { name: "Current MC",       value: mc,   inline: true },
          { name: "Detected Price",   value: cp0,  inline: true },
          { name: "MC at Detection",  value: mc0,  inline: true },
          { name: "Detected",         value: `<t:${Math.floor(token.detectedAt / 1000)}:R>`, inline: true },
        ],
        footer: { text: "Soloris · MemeScreener Milestones" },
        timestamp: new Date().toISOString(),
      }],
    }),
  });
}

async function checkMemeMilestones(state, { webhook } = {}) {
  const tokens = (state.tokens || []).filter(t => t.detected_price && t.detected_price > 0);
  if (!tokens.length) return { checked: 0, milestones: 0 };

  // Fetch current prices for all tracked tokens via DexScreener
  const mints = tokens.map(t => t.mint);
  let pairMap = {};
  try { pairMap = await fetchDexPairs(mints); } catch { return { checked: 0, milestones: 0 }; }

  let milestoneCount = 0;

  for (const token of state.tokens) {
    if (!token.detected_price || token.detected_price <= 0) continue;
    const pair = pairMap[token.mint];
    if (!pair?.priceUsd) continue;

    const currentPrice = parseFloat(pair.priceUsd);
    const currentMC    = pair.fdv ? parseFloat(pair.fdv) : null;
    const multiple     = currentPrice / token.detected_price;

    for (const m of MILESTONES) {
      if (multiple >= m && !(token.milestones_hit || []).includes(`${m}x`)) {
        token.milestones_hit = [...(token.milestones_hit || []), `${m}x`];
        try {
          await sendMilestoneAlert(webhook, token, m, currentPrice, currentMC);
          milestoneCount++;
        } catch { /* non-fatal */ }
      }
    }

    // Keep current price updated on the token record for the frontend
    token.current_price = currentPrice;
    token.current_mc    = currentMC;
    token.current_multiple = Math.round(multiple * 10) / 10;
  }

  return { checked: tokens.length, milestones: milestoneCount };
}

module.exports = { runMemeAutoScan, checkMemeMilestones, defaultState };
