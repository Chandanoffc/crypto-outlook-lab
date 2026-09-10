"use strict";
/**
 * meme-autoscan.js
 * Scans Pump.fun fresh graduates for tokens with POST-graduation momentum.
 * Strategy: catch winners in the 5–20 min window after graduation while
 * price is still moving up but hasn't fully pumped yet.
 *
 * Key insight: meme coins diverge immediately on graduation — winners
 * go from $69K → $5M+ within minutes; losers die to near-zero.
 * We need to detect momentum within the first 20 minutes.
 *
 * Called from api/cron-scan.js on each cron tick.
 */

const HELIUS_KEY = process.env.HELIUS_API_KEY || "";
const RPC_URL    = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;

const COOLDOWN_MS     = 6 * 60 * 60 * 1000;   // 6h per token
const MAX_GRAD_AGE_MS = 20 * 60 * 1000;        // < 20 min since graduation (not creation)
const MAX_TOKENS      = 100;

// ── Thresholds ─────────────────────────────────────────────
const MIN_MC_USD           = 80_000;    // already moved past graduation floor (~$69K)
const MAX_MC_USD           = 3_000_000; // still has room to run
const MIN_LIQUIDITY_USD    = 8_000;     // meaningful pool
const MIN_VOL5M_USD        = 5_000;     // actively trading RIGHT NOW
const MIN_VOL5M_TO_1H_PCT  = 30;        // ≥ 30% of 1h vol in last 5 min = fresh momentum
const MIN_PRICE_CHANGE_5M  = 0;         // price must be going up in last 5 min
const MAX_TOP10_PCT        = 35;        // tighter holder concentration limit
const MIN_SCORE_PCT        = 55;        // composite rubric

// ── Trending narrative keywords ────────────────────────────
// Tokens whose name/symbol matches current viral topics run much harder.
// Scan also flags these as a bonus signal.
const NARRATIVE_KEYWORDS = [
  "trump","maga","pepe","doge","shib","elon","musk","ai","gpt","agi","bitcoin","btc","sol",
  "gta","beast","pump","frog","cat","dog","baby","chad","moon","ape","wojak","npc",
  "based","gigachad","sigma","rekt","gem","100x","1000x","bonk",
];

// ── Sources ────────────────────────────────────────────────

async function fetchRecentGraduates() {
  try {
    // Sort by last_trade_timestamp to catch coins that just graduated (even if created long ago)
    const url = "https://frontend-api-v3.pump.fun/coins?complete=true&sort=last_trade_timestamp&order=DESC&limit=100&includeNsfw=false";
    const r = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!r.ok) return [];
    const data = await r.json();
    const coins = Array.isArray(data) ? data : [];
    // Return all graduates — we'll use DexScreener's pairCreatedAt as the real graduation timestamp
    return coins.filter(c => c.mint);
  } catch { return []; }
}

async function fetchDexPairs(mints) {
  if (!mints.length) return {};
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

    const BURN = new Set([
      "1nc1nerator11111111111111111111111111111111",
      "11111111111111111111111111111111",
      "burnAddressXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    ]);
    const accounts = (largestAccounts?.value || []).filter(a => !BURN.has(a.address));
    const totalSupply = parseFloat(supplyResult?.value?.uiAmount || 0);
    const top10Sum = accounts.slice(0, 10).reduce((s, a) => s + parseFloat(a.uiAmount || 0), 0);
    const top10_holder_pct = totalSupply > 0 ? (top10Sum / totalSupply) * 100 : null;
    const unique_holders   = accounts.length;

    // Bundle detection: top 3 wallets holding >50% collectively = likely insider bundle
    const top3Sum = accounts.slice(0, 3).reduce((s, a) => s + parseFloat(a.uiAmount || 0), 0);
    const top3_pct = totalSupply > 0 ? (top3Sum / totalSupply) * 100 : null;
    const likely_bundled = top3_pct != null && top3_pct > 50;

    const name   = asset?.content?.metadata?.name   || tokenInfo.symbol || "";
    const symbol = asset?.content?.metadata?.symbol || tokenInfo.symbol || "";

    return {
      name, symbol,
      mint_authority_revoked,
      freeze_authority_revoked,
      top10_holder_pct,
      unique_holders,
      likely_bundled,
    };
  } catch { return null; }
}

// ── Narrative detection ───────────────────────────────────

function detectNarrative(name, symbol) {
  const lower = `${name} ${symbol}`.toLowerCase();
  const matches = NARRATIVE_KEYWORDS.filter(k => lower.includes(k));
  return matches.length > 0 ? matches.slice(0, 3) : [];
}

// ── Time-of-day score bonus ───────────────────────────────
// Memes run harder during US/EU active hours (UTC 13:00–00:00)

function timeBonus() {
  const h = new Date().getUTCHours();
  if (h >= 13 && h <= 23) return 0.1;   // US/EU prime time
  if (h >= 8  && h <= 12) return 0.05;  // EU morning
  return 0;
}

// ── Scoring ───────────────────────────────────────────────

function scoreContractSafety(mint_revoked, freeze_revoked) {
  if (mint_revoked && freeze_revoked) return 2;
  if (!mint_revoked) return 0;
  return 1;
}

function scoreDistribution(top10, likely_bundled) {
  if (top10 == null) return null;
  if (likely_bundled || top10 > MAX_TOP10_PCT) return 0;
  if (top10 < 20) return 2;
  return 1;
}

function scoreMomentum(priceChange5m, vol5m, vol1h) {
  // 5-min momentum is the most predictive signal
  const pct5m = priceChange5m || 0;
  const vol5mRatio = vol1h > 0 ? (vol5m / vol1h) * 100 : 0;

  if (pct5m <= 0) return 0;                      // price going down right now → skip
  if (pct5m >= 20 && vol5mRatio >= 40) return 2; // strong momentum
  if (pct5m >= 5  && vol5mRatio >= 20) return 1;
  return null;
}

function computeScore({ mint_authority_revoked, freeze_authority_revoked, top10_holder_pct, likely_bundled, priceChange5m, vol5m, vol1h }) {
  const subs = {
    contract_safety: scoreContractSafety(mint_authority_revoked, freeze_authority_revoked),
    distribution:    scoreDistribution(top10_holder_pct, likely_bundled),
    momentum_5m:     scoreMomentum(priceChange5m, vol5m, vol1h),
  };
  const nonNull = Object.values(subs).filter(v => v !== null);
  let composite = nonNull.length ? nonNull.reduce((s, v) => s + v, 0) / (2 * nonNull.length) : null;
  if (composite != null) composite = Math.min(1, composite + timeBonus());

  const forced_high_risk = subs.distribution === 0 || subs.momentum_5m === 0;
  return { sub_scores: subs, composite_score: composite, forced_high_risk };
}

// ── Pre-filter by momentum metrics ───────────────────────

function qualifies(pair, helius) {
  const liq       = pair.liquidity?.usd  || 0;
  const mc        = pair.fdv             || 0;
  const vol5m     = pair.volume?.m5      || 0;
  const vol1h     = pair.volume?.h1      || 0;
  const price5m   = pair.priceChange?.m5 || 0;

  if (liq < MIN_LIQUIDITY_USD) return false;
  if (mc < MIN_MC_USD)         return false;
  if (mc > MAX_MC_USD && mc !== 0) return false;
  if (vol5m < MIN_VOL5M_USD)   return false;                                // must be actively trading now
  if (price5m <= MIN_PRICE_CHANGE_5M) return false;                         // price must be going up
  if (vol1h > 0 && (vol5m / vol1h) * 100 < MIN_VOL5M_TO_1H_PCT) return false; // momentum must be fresh

  if (helius) {
    if (helius.likely_bundled)                                                   return false; // insider bundle
    if (helius.top10_holder_pct != null && helius.top10_holder_pct > MAX_TOP10_PCT) return false;
    if (!helius.mint_authority_revoked)                                          return false;
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
  const vol5m  = token.vol_5m_usd    ? `$${Number(token.vol_5m_usd).toLocaleString()}`   : "—";
  const vol1h  = token.vol_h1_usd    ? `$${Number(token.vol_h1_usd).toLocaleString()}`   : "—";
  const mc     = token.detected_mc   ? `$${Number(token.detected_mc).toLocaleString()}`  : "—";
  const price  = token.price_usd     ? `$${parseFloat(token.price_usd).toExponential(3)}`  : "—";
  const age    = token.age_minutes   != null ? `${token.age_minutes}m` : "—";
  const top10  = token.top10_holder_pct != null ? `${token.top10_holder_pct.toFixed(1)}%` : "—";
  const p5m    = token.price_change_5m  != null ? `${token.price_change_5m > 0 ? "+" : ""}${token.price_change_5m.toFixed(1)}%` : "—";
  const vol5mRatio = token.vol_5m_to_1h_pct != null ? `${token.vol_5m_to_1h_pct.toFixed(0)}% of 1h` : "—";
  const scoreStr = score != null ? `${Math.round(score * 100)}%` : "—";
  const bundled  = token.likely_bundled ? "⚠️ BUNDLE DETECTED" : "✅ Clean";
  const narrative = token.narrative?.length ? `🎯 ${token.narrative.join(", ")}` : "—";

  const subRows = Object.entries(token.sub_scores || {})
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v === null ? "—" : v === 0 ? "🔴 0" : v === 1 ? "🟡 1" : "🟢 2"}`)
    .join("\n");

  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        title: `🚀 ${sym} — Fresh Graduate Runner`,
        url: token.pair_url || undefined,
        color,
        description: `🎰 Pump.fun graduate detected within ${age} of graduation`,
        fields: [
          { name: "Mint CA",          value: `\`${token.mint}\``,  inline: false },
          { name: "Score",            value: scoreStr,              inline: true },
          { name: "Price",            value: price,                 inline: true },
          { name: "MC at Detection",  value: mc,                    inline: true },
          { name: "Age",              value: age,                   inline: true },
          { name: "Liquidity",        value: liq,                   inline: true },
          { name: "5m Price Change",  value: p5m,                   inline: true },
          { name: "Vol 5m",           value: vol5m,                 inline: true },
          { name: "Vol 5m of 1h",     value: vol5mRatio,            inline: true },
          { name: "Vol 1h",           value: vol1h,                 inline: true },
          { name: "Top 10 %",         value: top10,                 inline: true },
          { name: "Bundle Check",     value: bundled,               inline: true },
          { name: "Narrative",        value: narrative,             inline: false },
          { name: "Sub-scores",       value: subRows,               inline: false },
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

  // 1. Fetch fresh graduates (< 20 min old)
  const graduates = await fetchRecentGraduates();
  if (!graduates.length) return summary;

  const mints = graduates.map(g => g.mint);
  summary.checked = mints.length;

  // 2. Get DexScreener pairs — includes 5m price change and volume
  const pairMap = await fetchDexPairs(mints);

  // 3. Pre-filter by momentum (fast, no Helius call needed yet)
  // Use pairCreatedAt from DexScreener as the real graduation timestamp — not pump.fun's
  // created_timestamp, which is when the token was born (could be hours before graduation).
  const candidates = mints.filter(mint => {
    const pair = pairMap[mint];
    if (!pair) return false;
    const liq         = pair.liquidity?.usd  || 0;
    const mc          = pair.fdv             || 0;
    const vol5m       = pair.volume?.m5      || 0;
    const vol1h       = pair.volume?.h1      || 0;
    const p5m         = pair.priceChange?.m5 || 0;
    const pairCreated = pair.pairCreatedAt   || 0;
    const ageOnDex    = pairCreated ? now - pairCreated : Infinity;

    return (
      ageOnDex <= MAX_GRAD_AGE_MS &&         // DEX pair < 20 min old = just graduated
      liq   >= MIN_LIQUIDITY_USD &&
      mc    >= MIN_MC_USD &&
      (mc === 0 || mc <= MAX_MC_USD) &&
      vol5m >= MIN_VOL5M_USD &&
      p5m   > MIN_PRICE_CHANGE_5M &&
      (vol1h === 0 || (vol5m / vol1h) * 100 >= MIN_VOL5M_TO_1H_PCT)
    );
  });

  if (!candidates.length) return summary;

  // 4. Fetch Helius data in batches of 5
  const BATCH = 5;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const heliusResults = await Promise.all(batch.map(m => fetchHeliusData(m)));

    for (let j = 0; j < batch.length; j++) {
      const mint   = batch[j];
      const helius = heliusResults[j];
      const pair   = pairMap[mint];
      const grad   = graduates.find(g => g.mint === mint);

      if (!qualifies(pair, helius)) continue;

      const vol5m  = pair.volume?.m5      || 0;
      const vol1h  = pair.volume?.h1      || 0;
      const liq    = pair.liquidity?.usd  || 0;
      const p5m    = pair.priceChange?.m5 || 0;
      const mc     = pair.fdv             || 0;

      const vol5mTo1hPct = vol1h > 0 ? (vol5m / vol1h) * 100 : null;
      // Age since graduation (DEX pair creation), not since pump.fun token birth
      const ageMs = pair.pairCreatedAt ? now - pair.pairCreatedAt : null;

      const scoreData = {
        mint_authority_revoked:   helius?.mint_authority_revoked   ?? true,
        freeze_authority_revoked: helius?.freeze_authority_revoked ?? true,
        top10_holder_pct:         helius?.top10_holder_pct         ?? null,
        likely_bundled:           helius?.likely_bundled           ?? false,
        priceChange5m:            p5m,
        vol5m,
        vol1h,
      };
      const { sub_scores, composite_score, forced_high_risk } = computeScore(scoreData);

      if (forced_high_risk) continue;
      if (composite_score != null && composite_score * 100 < MIN_SCORE_PCT) continue;

      summary.qualified++;

      // Cooldown check
      const lastAlerted = state.alerts?.[mint] || 0;
      if (now - lastAlerted < COOLDOWN_MS) continue;

      const detectedPrice = pair.priceUsd ? parseFloat(pair.priceUsd) : null;

      const token = {
        id:             `${mint}_${now}`,
        mint,
        name:           helius?.name   || pair.baseToken?.name   || grad?.name   || mint.slice(0, 8),
        symbol:         helius?.symbol || pair.baseToken?.symbol || grad?.symbol || "?",
        source:         "pumpfun",
        price_usd:      detectedPrice,
        detected_price: detectedPrice,
        detected_mc:    mc || null,
        liquidity_usd:  liq,
        vol_5m_usd:     vol5m,
        vol_h1_usd:     vol1h,
        vol_5m_to_1h_pct: vol5mTo1hPct,
        price_change_5m: p5m,
        fdv_usd:        mc || null,
        age_minutes:    ageMs != null ? Math.floor(ageMs / 60000) : null,
        top10_holder_pct: helius?.top10_holder_pct ?? null,
        unique_holders:   helius?.unique_holders ?? null,
        likely_bundled:   helius?.likely_bundled ?? false,
        mint_authority_revoked:   scoreData.mint_authority_revoked,
        freeze_authority_revoked: scoreData.freeze_authority_revoked,
        narrative:      detectNarrative(grad?.name || "", grad?.symbol || ""),
        pair_url:       pair.url || null,
        sub_scores,
        composite_score,
        detectedAt:     now,
        milestones_hit: [],
      };

      state.tokens = [token, ...(state.tokens || []).filter(t => t.mint !== mint)].slice(0, MAX_TOKENS);
      state.alerts = state.alerts || {};
      state.alerts[mint] = now;

      try {
        await sendAlert(webhook, token);
        summary.alerted++;
      } catch (e) {
        summary.errors.push(e.message);
      }
    }
  }

  state.lastScan = now;

  const cutoff = now - 24 * 60 * 60 * 1000;
  for (const [mint, ts] of Object.entries(state.alerts || {})) {
    if (ts < cutoff) delete state.alerts[mint];
  }

  return summary;
}

// ── Milestone tracker ─────────────────────────────────────

const MILESTONES = [2, 3, 4, 5, 10];

async function sendMilestoneAlert(webhook, token, multiple, currentPrice, currentMC) {
  if (!webhook) return;
  const sym   = token.symbol || token.name || token.mint.slice(0, 8);
  const emoji = multiple >= 10 ? "🚀🚀🚀" : multiple >= 5 ? "🚀🚀" : multiple >= 3 ? "🔥" : "✅";
  const mc    = currentMC        ? `$${Number(currentMC).toLocaleString()}`               : "—";
  const mc0   = token.detected_mc ? `$${Number(token.detected_mc).toLocaleString()}`      : "—";
  const cp    = currentPrice      ? `$${parseFloat(currentPrice).toExponential(3)}`        : "—";
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
          { name: "Mint CA",         value: `\`${token.mint}\``, inline: false },
          { name: "Milestone",       value: `${multiple}x from detection`, inline: true },
          { name: "Current Price",   value: cp,  inline: true },
          { name: "Current MC",      value: mc,  inline: true },
          { name: "Detected Price",  value: cp0, inline: true },
          { name: "MC at Detection", value: mc0, inline: true },
          { name: "Detected",        value: `<t:${Math.floor(token.detectedAt / 1000)}:R>`, inline: true },
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

    token.current_price    = currentPrice;
    token.current_mc       = currentMC;
    token.current_multiple = Math.round(multiple * 10) / 10;
  }

  return { checked: tokens.length, milestones: milestoneCount };
}

module.exports = { runMemeAutoScan, checkMemeMilestones, defaultState };
