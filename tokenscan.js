/* tokenscan.js — AI Memecoin Research Engine for Solana */

// ── API endpoints ──────────────────────────────────────────────────────────
const DS_BASE = 'https://api.dexscreener.com';
const RC_BASE = 'https://api.rugcheck.xyz/v1';
const JUP_PRICE = 'https://api.jup.ag/price/v2';
const METEORA_BASE = 'https://dlmm-api.meteora.ag';

// ── Narrative classifier ───────────────────────────────────────────────────
const NARRATIVES = [
  { tag: 'Dog',      emoji: '🐕', keywords: ['doge','dog','puppy','woof','shib','bonk','floki','inu','bark','hound','poodle','husky','corgi','mutt'] },
  { tag: 'Cat',      emoji: '🐱', keywords: ['cat','nyan','meow','paw','kitty','tabby','kitten','purr','feline'] },
  { tag: 'AI',       emoji: '🤖', keywords: ['ai','gpt','llm','neural','machine','compute','nvidia','claude','agent','brain','robot','cyber'] },
  { tag: 'Political',emoji: '🏛️', keywords: ['trump','biden','maga','republican','democrat','vote','election','potus','kamala','politics','gop'] },
  { tag: 'Pepe',     emoji: '🐸', keywords: ['pepe','wojak','chad','based','gigachad','frog','clown','honk','feels','rare'] },
  { tag: 'Gaming',   emoji: '🎮', keywords: ['game','play','pixel','arcade','pong','mario','pokemon','sonic','gamer','rpg','quest','sword','coin'] },
  { tag: 'Anime',    emoji: '⛩️', keywords: ['anime','manga','naruto','goku','demon','waifu','otaku','slice','isekai','shinobi','samurai'] },
  { tag: 'Celebrity',emoji: '⭐', keywords: ['elon','kanye','taylor','musk','bezos','swift','ye','snoop','drake','rogan'] },
  { tag: 'Space',    emoji: '🚀', keywords: ['moon','mars','space','rocket','galaxy','star','cosmos','astro','orbit','nasa','alien'] },
  { tag: 'Finance',  emoji: '💰', keywords: ['degen','lambo','diamond','hands','ape','yolo','wagmi','ngmi','fomo','bull','bear','gm'] },
  { tag: 'Sports',   emoji: '🏆', keywords: ['nfl','nba','soccer','football','basketball','baseball','sport','goat','champion','league'] },
  { tag: 'Food',     emoji: '🍕', keywords: ['pizza','burger','taco','sushi','ramen','bread','cake','cookie','donut','food','eat','yum'] },
  { tag: 'Solana',   emoji: '◎', keywords: ['sol','solana','saga','bonk','jto','jup','pyth','drift','meteora','raydium','orca'] },
  { tag: 'Music',    emoji: '🎵', keywords: ['music','beat','rap','hip','hop','pop','rock','band','song','melody','tune','vinyl'] },
];

function classifyNarrative(name = '', symbol = '') {
  const text = (name + ' ' + symbol).toLowerCase();
  for (const n of NARRATIVES) {
    if (n.keywords.some(k => text.includes(k))) return n;
  }
  return { tag: 'Misc', emoji: '✦', keywords: [] };
}

// ── Scoring system ─────────────────────────────────────────────────────────
function scoreToken(dex, rug) {
  const pair = dex;
  const vol24 = pair?.volume?.h24 || 0;
  const liqUsd = pair?.liquidity?.usd || 0;
  const mc = pair?.marketCap || pair?.fdv || 0;
  const pc24 = pair?.priceChange?.h24 || 0;
  const pc1h = pair?.priceChange?.h1 || 0;
  const txns24 = pair?.txns?.h24 || {};
  const buys24 = txns24.buys || 0;
  const sells24 = txns24.sells || 0;
  const ageMs = pair?.pairCreatedAt ? Date.now() - pair.pairCreatedAt : 0;
  const ageH = ageMs / 3_600_000;

  const rugScore = rug?.score || 0;
  const holders = rug?.totalHolders || 0;
  const lockedPct = rug?.lockedPct || 0;
  const risks = rug?.risks || [];
  const topHolders = rug?.topHolders || [];

  const hasMintAuth = risks.some(r => /mint authority/i.test(r.name));
  const hasFreezeAuth = risks.some(r => /freeze authority/i.test(r.name));
  const top10Pct = topHolders.slice(0, 10).reduce((s, h) => s + (h.pct || 0), 0);

  // Safety (0–100): lower rugcheck score = safer
  let safety = 100;
  if (rugScore > 5000) safety = 0;
  else if (rugScore > 3000) safety = 15;
  else if (rugScore > 2000) safety = 35;
  else if (rugScore > 1000) safety = 60;
  else if (rugScore > 500) safety = 80;
  else safety = 95;
  if (hasMintAuth) safety = Math.max(0, safety - 40);
  if (hasFreezeAuth) safety = Math.max(0, safety - 25);
  if (lockedPct < 50 && rug) safety = Math.max(0, safety - 15);
  if (top10Pct > 60) safety = Math.max(0, safety - 15);
  if (top10Pct > 40) safety = Math.max(0, safety - 8);

  // Liquidity (0–100)
  let liquidity = 0;
  if (liqUsd > 1_000_000) liquidity = 100;
  else if (liqUsd > 500_000) liquidity = 88;
  else if (liqUsd > 200_000) liquidity = 74;
  else if (liqUsd > 100_000) liquidity = 60;
  else if (liqUsd > 50_000) liquidity = 46;
  else if (liqUsd > 20_000) liquidity = 32;
  else if (liqUsd > 10_000) liquidity = 20;
  else liquidity = 5;

  // Holder (0–100)
  let holder = 0;
  if (holders > 10_000) holder = 100;
  else if (holders > 5_000) holder = 85;
  else if (holders > 2_000) holder = 68;
  else if (holders > 1_000) holder = 52;
  else if (holders > 500) holder = 38;
  else if (holders > 100) holder = 22;
  else holder = 8;
  if (top10Pct < 20) holder = Math.min(100, holder + 12);
  else if (top10Pct < 35) holder = Math.min(100, holder + 5);

  // Volume (0–100)
  let volume = 0;
  if (vol24 > 5_000_000) volume = 100;
  else if (vol24 > 2_000_000) volume = 88;
  else if (vol24 > 1_000_000) volume = 76;
  else if (vol24 > 500_000) volume = 62;
  else if (vol24 > 200_000) volume = 48;
  else if (vol24 > 100_000) volume = 34;
  else if (vol24 > 50_000) volume = 20;
  else volume = 5;

  // Momentum (0–100)
  let momentum = 50;
  if (pc24 > 100) momentum += 30;
  else if (pc24 > 50) momentum += 20;
  else if (pc24 > 20) momentum += 12;
  else if (pc24 > 0) momentum += 5;
  else if (pc24 < -50) momentum -= 30;
  else if (pc24 < -20) momentum -= 15;
  else if (pc24 < 0) momentum -= 8;

  if (buys24 > 0 && sells24 > 0) {
    const bsRatio = buys24 / (buys24 + sells24);
    if (bsRatio > 0.65) momentum += 15;
    else if (bsRatio > 0.55) momentum += 8;
    else if (bsRatio < 0.35) momentum -= 15;
    else if (bsRatio < 0.45) momentum -= 8;
  }
  if (pc1h > 10) momentum += 8;
  else if (pc1h < -10) momentum -= 8;
  momentum = Math.max(0, Math.min(100, momentum));

  // Age score (0–100): sweet spot is 6–72h
  let age = 0;
  if (ageH > 72) age = 70;
  else if (ageH > 24) age = 90;
  else if (ageH > 6) age = 75;
  else if (ageH > 1) age = 50;
  else age = 20;

  // Narrative (0–100)
  const narr = classifyNarrative(pair?.baseToken?.name, pair?.baseToken?.symbol);
  const trendingNarratives = ['AI', 'Political', 'Pepe', 'Dog', 'Space'];
  let narrative = 40;
  if (trendingNarratives.includes(narr.tag)) narrative = 75;
  if (narr.tag === 'Misc') narrative = 25;

  // Alpha Score (weighted composite)
  const alpha = Math.round(
    0.25 * safety +
    0.20 * liquidity +
    0.15 * holder +
    0.20 * momentum +
    0.10 * volume +
    0.05 * age +
    0.05 * narrative
  );

  return {
    alpha,
    dims: { safety, liquidity, holder, volume, momentum, age, narrative },
    flags: {
      hasMintAuth,
      hasFreezeAuth,
      lpLocked: lockedPct >= 80,
      lpLockedPct: lockedPct,
      top10Pct,
      rugScore,
      holders,
      ageH,
    },
    narrative: narr,
  };
}

function verdictFromScore(score) {
  if (score >= 80) return { label: '🌙 Moonshot', tier: 'moonshot', color: '#A78BFA', bg: 'rgba(139,92,246,.18)' };
  if (score >= 65) return { label: '🔥 High Conviction', tier: 'conviction', color: '#F59E0B', bg: 'rgba(245,158,11,.14)' };
  if (score >= 50) return { label: '✅ Bullish', tier: 'bullish', color: '#4ADE80', bg: 'rgba(74,222,128,.12)' };
  if (score >= 35) return { label: '⚖️ Neutral', tier: 'neutral', color: '#94A3B8', bg: 'rgba(148,163,184,.10)' };
  if (score >= 20) return { label: '⚠️ Caution', tier: 'caution', color: '#F59E0B', bg: 'rgba(245,158,11,.10)' };
  return { label: '🚨 Avoid', tier: 'avoid', color: '#F87171', bg: 'rgba(248,113,113,.14)' };
}

// ── Fetch helpers ──────────────────────────────────────────────────────────
async function fetchDexToken(addressOrSymbol) {
  const isAddr = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addressOrSymbol.trim());
  const url = isAddr
    ? `${DS_BASE}/latest/dex/tokens/${addressOrSymbol.trim()}`
    : `${DS_BASE}/latest/dex/search/?q=${encodeURIComponent(addressOrSymbol.trim())}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DexScreener ${res.status}`);
  const data = await res.json();
  const pairs = (data.pairs || []).filter(p => p.chainId === 'solana');
  if (!pairs.length) throw new Error('No Solana pairs found');
  pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  return pairs[0];
}

async function fetchRugCheck(mint) {
  try {
    const res = await fetch(`${RC_BASE}/tokens/${mint}/report`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchMeteoraLPPools(mint) {
  try {
    // DexScreener indexes all Meteora DLMM pools — pull all pairs for the token
    // and filter for dexId 'meteora' or 'meteoradlmm'
    const res = await fetch(`${DS_BASE}/latest/dex/tokens/${mint}`);
    if (!res.ok) return [];
    const data = await res.json();
    const pairs = (data?.pairs || []).filter(p =>
      p.chainId === 'solana' && (p.dexId === 'meteora' || p.dexId === 'meteoradlmm')
    );
    // Filter dust pools, sort by volume
    const meaningful = pairs.filter(p => (p.liquidity?.usd || 0) >= 10_000);
    meaningful.sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0));
    return meaningful.slice(0, 6).map(p => ({
      // Map DexScreener pair shape to our LP pool shape
      address: p.pairAddress,
      name: `${p.baseToken?.symbol}/${p.quoteToken?.symbol}`,
      mint_x: p.baseToken?.address,
      mint_y: p.quoteToken?.address,
      quoteSymbol: p.quoteToken?.symbol || '?',
      // DexScreener doesn't expose bin_step or exact fee — estimate from vol/liq ratio
      bin_step: null,
      base_fee_percentage: estimateFeeTier(p),
      liquidity: String(p.liquidity?.usd || 0),
      volume_24h: p.volume?.h24 || 0,
      fees_24h: estimateFees24h(p),
      fee_apr: estimateFeeApr(p),
      pairAddress: p.pairAddress,
      priceChange24h: p.priceChange?.h24 || 0,
    }));
  } catch { return []; }
}

function estimateFeeTier(pair) {
  // Meteora DLMM fee tiers: 0.01, 0.04, 0.08, 0.16, 0.25, 0.5, 1, 2%
  // Heuristic: vol/liq ratio suggests active fee tier
  const vol = pair.volume?.h24 || 0;
  const liq = pair.liquidity?.usd || 1;
  const ratio = vol / liq;
  if (ratio > 10) return '1.00';
  if (ratio > 3)  return '0.50';
  if (ratio > 1)  return '0.25';
  if (ratio > 0.3) return '0.08';
  return '0.04';
}

function estimateFees24h(pair) {
  const vol = pair.volume?.h24 || 0;
  const feePct = parseFloat(estimateFeeTier(pair)) / 100;
  return vol * feePct;
}

function estimateFeeApr(pair) {
  const fees = estimateFees24h(pair);
  const liq = pair.liquidity?.usd || 0;
  if (!liq) return 0;
  return (fees * 365 / liq) * 100;
}

function scoreLpPool(pool, tokenMomentum = 50) {
  const tvl = parseFloat(pool.liquidity) || 0;
  const vol24 = parseFloat(pool.volume_24h || pool.trade_volume_24h) || 0;
  const fees24 = parseFloat(pool.fees_24h || pool.today_fees) || 0;
  const feeApr = pool.fee_apr || (tvl > 0 ? (fees24 * 365 / tvl * 100) : 0);
  const binStep = pool.bin_step || null;
  const name = (pool.name || '').toUpperCase();
  const quoteSymbol = (pool.quoteSymbol || '').toUpperCase();

  // IL risk based on quote token
  let ilRisk, ilPenalty;
  if (/USDC|USDT|USDS|DAI/.test(quoteSymbol || name)) { ilRisk = 'High'; ilPenalty = 30; }
  else if (/SOL|WSOL/.test(quoteSymbol || name)) { ilRisk = 'Medium'; ilPenalty = 15; }
  else { ilRisk = 'Very High'; ilPenalty = 40; }

  const binRisk = binStep ? (binStep <= 20 ? 'Narrow (Active)' : binStep <= 80 ? 'Medium' : 'Wide (Passive)') : 'DLMM';

  // Net APR estimate: fee APR minus IL cost
  const ilCostEst = ilPenalty * (tokenMomentum < 40 ? 1.5 : tokenMomentum > 65 ? 0.6 : 1.0);
  const netApr = Math.max(0, feeApr - ilCostEst);

  // Opportunity score 0–100
  let score = 0;
  if (feeApr > 200) score = 90;
  else if (feeApr > 100) score = 78;
  else if (feeApr > 50) score = 64;
  else if (feeApr > 20) score = 48;
  else if (feeApr > 10) score = 32;
  else score = 15;

  // Penalise very low TVL (thin pool = high slippage for LPs when rebalancing)
  if (tvl < 5000) score -= 20;
  else if (tvl < 20000) score -= 10;

  // Reward volume/TVL efficiency
  const volTvlRatio = tvl > 0 ? vol24 / tvl : 0;
  if (volTvlRatio > 2) score += 10;
  else if (volTvlRatio > 1) score += 5;

  score = Math.max(0, Math.min(100, score));

  let verdict, verdictColor;
  if (score >= 75) { verdict = '🔥 Prime'; verdictColor = '#A78BFA'; }
  else if (score >= 55) { verdict = '✅ Good'; verdictColor = '#4ADE80'; }
  else if (score >= 35) { verdict = '⚖️ Fair'; verdictColor = '#F59E0B'; }
  else { verdict = '⚠️ Thin'; verdictColor = '#F87171'; }

  return { score, feeApr, netApr, ilRisk, ilPenalty: ilCostEst, binRisk, vol24, tvl, fees24, verdict, verdictColor };
}

function renderMeteoraSection(pools, tokenMomentum) {
  if (!pools.length) {
    return `<div class="ts-report-section">
      <div class="ts-report-title">◎ Meteora LP Opportunities</div>
      <div class="ts-lp-empty">No active Meteora DLMM pools found for this token</div>
    </div>`;
  }

  const rows = pools.map(pool => {
    const lp = scoreLpPool(pool, tokenMomentum);
    const name = pool.name || '—';
    const baseFee = pool.base_fee_percentage ? `~${parseFloat(pool.base_fee_percentage).toFixed(2)}%` : '—';
    const poolAddr = pool.pairAddress || pool.address || '';
    const link = poolAddr ? `https://app.meteora.ag/dlmm/${poolAddr}` : 'https://app.meteora.ag/pools';

    return `
      <tr>
        <td><a href="${link}" target="_blank" rel="noopener" class="ts-lp-link">${name}</a></td>
        <td class="mono">${baseFee}<br><span style="color:var(--tx-3);font-size:9px">${pool.bin_step ? 'Bin '+pool.bin_step : 'DLMM'}</span></td>
        <td class="mono">${fmt$(lp.tvl)}</td>
        <td class="mono">${fmt$(lp.vol24)}</td>
        <td class="mono bold" style="color:var(--ac)">${lp.feeApr > 9999 ? '>9999%' : lp.feeApr > 0 ? lp.feeApr.toFixed(0) + '%' : '—'}</td>
        <td class="mono" style="color:${lp.netApr > 20 ? '#4ADE80' : lp.netApr > 0 ? '#F59E0B' : '#F87171'}">${lp.netApr > 0 ? '~' + lp.netApr.toFixed(0) + '%' : 'Low'}</td>
        <td><span style="color:${lp.ilRisk === 'High' || lp.ilRisk === 'Very High' ? '#F87171' : '#F59E0B'};font-size:10px;font-weight:700">${lp.ilRisk}</span></td>
        <td><span style="color:${lp.verdictColor};font-size:10px;font-weight:700">${lp.verdict}</span></td>
      </tr>`;
  }).join('');

  // Best pool advice
  const scored = pools.map(p => ({ pool: p, lp: scoreLpPool(p, tokenMomentum) })).sort((a, b) => b.lp.score - a.lp.score);
  const best = scored[0];
  let advice = '';
  if (best) {
    const { lp } = best;
    const bestName = best.pool.name || 'the top pool';
    if (lp.score >= 55) {
      advice = `<div class="ts-lp-advice">
        <span class="ts-lp-advice-label">💡 Best Opportunity</span>
        <strong>${bestName}</strong> — Fee APR ${lp.feeApr.toFixed(0)}% · Net est. ~${lp.netApr.toFixed(0)}% after ${lp.ilRisk.toLowerCase()} IL.
        ${lp.binRisk === 'Narrow (Active)' ? 'Narrow bins require active range management — check price daily.' :
          lp.binRisk === 'Wide (Passive)' ? 'Wide bins are passive — set and check weekly.' :
          'Medium bins — recheck position every 2–3 days.'}
        ${lp.ilRisk === 'High' ? ' USDC pair: you bear full IL on price moves — only LP here if you expect sideways action.' :
          lp.ilRisk === 'Medium' ? ' SOL pair: correlated assets reduce IL but don\'t eliminate it.' :
          ' Token/token pair: maximum IL exposure — only for experienced LPs.'}
      </div>`;
    }
  }

  return `<div class="ts-report-section">
    <div class="ts-report-title">◎ Meteora LP Opportunities</div>
    ${advice}
    <div class="ts-lp-table-wrap">
      <table class="ts-table ts-lp-table">
        <thead><tr>
          <th>Pool</th><th>Fee / Bins</th><th>TVL</th><th>Vol 24H</th><th>Fee APR</th><th>Net APR est.</th><th>IL Risk</th><th>Rating</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="font-size:10px;color:var(--tx-3);margin-top:8px">Net APR = Fee APR minus estimated IL cost. IL risk is higher on stable-paired pools due to divergence loss. Data: Meteora DLMM API.</div>
  </div>`;
}

async function fetchTrendingSolana() {
  const res = await fetch(`${DS_BASE}/token-boosts/latest/v1`);
  if (!res.ok) throw new Error(`DexScreener boosts ${res.status}`);
  const data = await res.json();
  return (data || []).filter(t => t.chainId === 'solana').slice(0, 30);
}

async function fetchNewProfiles() {
  const res = await fetch(`${DS_BASE}/token-profiles/latest/v1`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data || []).filter(t => t.chainId === 'solana').slice(0, 20);
}

// ── Format helpers ─────────────────────────────────────────────────────────
function fmt$(n) {
  if (!n || isNaN(n)) return '$—';
  if (n >= 1_000_000_000) return '$' + (n / 1_000_000_000).toFixed(2) + 'B';
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'K';
  if (n >= 1) return '$' + n.toFixed(0);
  return '$' + n.toFixed(4);
}
function fmtPct(n) {
  if (!n && n !== 0) return '—';
  const s = (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  return s;
}
function fmtAge(ms) {
  if (!ms) return '—';
  const h = ms / 3_600_000;
  if (h < 1) return Math.round(h * 60) + 'm';
  if (h < 24) return h.toFixed(1) + 'h';
  return (h / 24).toFixed(1) + 'd';
}
function fmtPrice(p) {
  if (!p) return '—';
  const n = parseFloat(p);
  if (n < 0.000001) return '$' + n.toExponential(2);
  if (n < 0.001) return '$' + n.toFixed(7);
  if (n < 1) return '$' + n.toFixed(5);
  return '$' + n.toFixed(4);
}
function shortAddr(a) { return a ? a.slice(0, 4) + '…' + a.slice(-4) : ''; }

// ── Generate AI analysis text ──────────────────────────────────────────────
function generateAnalysis(pair, rug, scores) {
  const { alpha, dims, flags, narrative } = scores;
  const verdict = verdictFromScore(alpha);
  const name = pair?.baseToken?.name || 'Unknown';
  const symbol = pair?.baseToken?.symbol || '?';
  const vol24 = pair?.volume?.h24 || 0;
  const liq = pair?.liquidity?.usd || 0;
  const mc = pair?.marketCap || pair?.fdv || 0;
  const pc24 = pair?.priceChange?.h24 || 0;

  const bullPoints = [];
  const bearPoints = [];

  if (dims.safety >= 80) bullPoints.push('No critical contract risks — mint/freeze authority disabled');
  if (flags.lpLocked) bullPoints.push(`LP ${flags.lpLockedPct.toFixed(0)}% locked — rug risk significantly reduced`);
  if (dims.holder >= 70) bullPoints.push(`Strong holder base (${flags.holders.toLocaleString()} holders) indicating organic distribution`);
  if (dims.momentum >= 70) bullPoints.push(`Strong upward momentum +${pc24.toFixed(0)}% 24H with healthy buy/sell ratio`);
  if (dims.liquidity >= 70) bullPoints.push(`Deep liquidity ${fmt$(liq)} — minimal slippage for entry/exit`);
  if (dims.volume >= 70) bullPoints.push(`High volume ${fmt$(vol24)} 24H — real market activity, not wash trading`);
  if (narrative.tag !== 'Misc') bullPoints.push(`${narrative.emoji} ${narrative.tag} narrative alignment — one of strongest memecoin catalysts`);
  if (flags.ageH > 24 && flags.ageH < 168) bullPoints.push('Token age in sweet spot (1–7 days) — early but survived initial dump');

  if (flags.hasMintAuth) bearPoints.push('⚠️ Mint authority ENABLED — developer can print unlimited supply');
  if (flags.hasFreezeAuth) bearPoints.push('⚠️ Freeze authority enabled — accounts can be frozen');
  if (!flags.lpLocked) bearPoints.push('LP not locked — liquidity can be pulled at any time (rug risk)');
  if (flags.top10Pct > 50) bearPoints.push(`Top 10 wallets hold ${flags.top10Pct.toFixed(0)}% — extreme concentration risk`);
  if (dims.momentum < 40) bearPoints.push('Weak or negative momentum — no strong directional move');
  if (dims.liquidity < 30) bearPoints.push(`Thin liquidity ${fmt$(liq)} — large orders will face significant slippage`);
  if (dims.holder < 30) bearPoints.push('Low holder count — early stage with limited organic distribution');
  if (flags.ageH < 2) bearPoints.push('Extremely new token (<2h) — high risk of early dump or rug');
  if (dims.safety < 40) bearPoints.push(`High RugCheck risk score (${flags.rugScore}) — multiple contract red flags`);

  // Executive summary
  let exec = '';
  if (alpha >= 65) {
    exec = `${name} ($${symbol}) presents a ${verdict.label.replace(/[^\w\s]/g, '').trim()} opportunity in the ${narrative.emoji} ${narrative.tag} narrative space. `;
    exec += `With ${fmt$(liq)} liquidity and ${fmt$(vol24)} 24H volume, market depth is ${liq > 100_000 ? 'adequate for meaningful position sizing' : 'limited — keep positions small'}. `;
    exec += dims.safety >= 70 ? 'Contract security checks are clean. ' : 'Contract carries some risk — position accordingly. ';
  } else if (alpha >= 35) {
    exec = `${name} ($${symbol}) is a mixed setup — some positive signals but significant risks present. `;
    exec += `The ${narrative.emoji} ${narrative.tag} narrative is ${narrative.tag !== 'Misc' ? 'working in its favor' : 'undifferentiated'}. `;
    exec += 'Proceed with caution and small position size only. ';
  } else {
    exec = `${name} ($${symbol}) shows multiple red flags across safety, liquidity, and momentum dimensions. `;
    exec += 'This is a high-risk setup with asymmetric downside. Avoid unless you are experienced with high-risk plays. ';
  }

  // Trade setup
  const price = parseFloat(pair?.priceUsd) || 0;
  let entry = null, tp1 = null, tp2 = null, sl = null;
  if (alpha >= 50 && price > 0) {
    entry = price;
    tp1 = price * (1 + Math.min(0.5, pc24 > 0 ? 0.3 : 0.2));
    tp2 = price * (1 + Math.min(1.5, pc24 > 0 ? 0.8 : 0.5));
    sl = price * (1 - (dims.safety < 60 ? 0.25 : 0.15));
  }

  return { exec, bullPoints, bearPoints, entry, tp1, tp2, sl, verdict };
}

// ── Render full token card ─────────────────────────────────────────────────
async function renderTokenCard(pair, rug, container) {
  const scores = scoreToken(pair, rug);
  const { alpha, dims, flags, narrative } = scores;
  const { exec, bullPoints, bearPoints, entry, tp1, tp2, sl, verdict } = generateAnalysis(pair, rug, scores);

  const name = pair?.baseToken?.name || 'Unknown';
  const symbol = pair?.baseToken?.symbol || '?';
  const mint = pair?.baseToken?.address || '';
  const imageUrl = pair?.info?.imageUrl;
  const socials = pair?.info?.socials || [];
  const websites = pair?.info?.websites || [];
  const vol24 = pair?.volume?.h24 || 0;
  const liq = pair?.liquidity?.usd || 0;
  const mc = pair?.marketCap || pair?.fdv || 0;
  const pc24 = pair?.priceChange?.h24 || 0;
  const pc1h = pair?.priceChange?.h1 || 0;
  const pc6h = pair?.priceChange?.h6 || 0;
  const txns24 = pair?.txns?.h24 || {};
  const buys = txns24.buys || 0;
  const sells = txns24.sells || 0;
  const ageMs = pair?.pairCreatedAt ? Date.now() - pair.pairCreatedAt : 0;

  const circumference = 2 * Math.PI * 26;
  const strokeDash = circumference * (alpha / 100);
  const ringColor = alpha >= 65 ? '#A78BFA' : alpha >= 50 ? '#4ADE80' : alpha >= 35 ? '#F59E0B' : '#F87171';

  const dimColor = (v) => v >= 70 ? '#4ADE80' : v >= 45 ? '#F59E0B' : '#F87171';

  const logoHtml = imageUrl
    ? `<img class="ts-token-logo" src="${imageUrl}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><div class="ts-token-logo-placeholder" style="display:none">${symbol[0]}</div>`
    : `<div class="ts-token-logo-placeholder">${symbol[0] || '?'}</div>`;

  // Risk flags
  const flagHtml = [
    flags.hasMintAuth ? '<span class="ts-flag danger">⚠ Mint Auth</span>' : '<span class="ts-flag ok">✓ No Mint</span>',
    flags.hasFreezeAuth ? '<span class="ts-flag danger">⚠ Freeze Auth</span>' : '<span class="ts-flag ok">✓ No Freeze</span>',
    flags.lpLocked ? `<span class="ts-flag ok">✓ LP ${flags.lpLockedPct.toFixed(0)}% Locked</span>` : '<span class="ts-flag danger">⚠ LP Unlocked</span>',
    flags.top10Pct > 50 ? `<span class="ts-flag danger">⚠ Top10: ${flags.top10Pct.toFixed(0)}%</span>` : flags.top10Pct > 30 ? `<span class="ts-flag warn">Top10: ${flags.top10Pct.toFixed(0)}%</span>` : `<span class="ts-flag ok">✓ Top10: ${flags.top10Pct.toFixed(0)}%</span>`,
    flags.holders > 0 ? `<span class="ts-flag ${flags.holders > 1000 ? 'ok' : 'warn'}">${flags.holders.toLocaleString()} Holders</span>` : '',
    flags.rugScore > 3000 ? `<span class="ts-flag danger">RugScore: ${flags.rugScore}</span>` : flags.rugScore > 1000 ? `<span class="ts-flag warn">RugScore: ${flags.rugScore}</span>` : `<span class="ts-flag ok">RugScore: ${flags.rugScore || '—'}</span>`,
  ].join('');

  // Social links
  const socialHtml = [
    ...websites.map(w => `<a class="ts-social-link" href="${w.url}" target="_blank" rel="noopener">${w.label || 'Website'}</a>`),
    ...socials.map(s => `<a class="ts-social-link" href="${s.url}" target="_blank" rel="noopener">${s.type}</a>`),
    `<a class="ts-social-link" href="https://dexscreener.com/solana/${mint}" target="_blank" rel="noopener">DexScreener</a>`,
    `<a class="ts-social-link" href="https://rugcheck.xyz/tokens/${mint}" target="_blank" rel="noopener">RugCheck</a>`,
  ].join('');

  // Trade setup HTML
  const tradeHtml = entry ? `
    <div class="ts-report-section">
      <div class="ts-report-title">Suggested Trade Setup</div>
      <div class="ts-trade-box">
        <div><div class="ts-trade-item-label">Entry</div><div class="ts-trade-item-value">${fmtPrice(entry)}</div></div>
        <div><div class="ts-trade-item-label">TP1 (+${((tp1/entry-1)*100).toFixed(0)}%)</div><div class="ts-trade-item-value" style="color:#4ADE80">${fmtPrice(tp1)}</div></div>
        <div><div class="ts-trade-item-label">TP2 (+${((tp2/entry-1)*100).toFixed(0)}%)</div><div class="ts-trade-item-value" style="color:#4ADE80">${fmtPrice(tp2)}</div></div>
        <div><div class="ts-trade-item-label">Stop Loss</div><div class="ts-trade-item-value" style="color:#F87171">${fmtPrice(sl)}</div></div>
        <div><div class="ts-trade-item-label">R/R Ratio</div><div class="ts-trade-item-value" style="color:var(--ac)">${((tp1/entry-1)/(entry/sl-1)).toFixed(1)}:1</div></div>
        <div><div class="ts-trade-item-label">Risk/Position</div><div class="ts-trade-item-value">1–3%</div></div>
      </div>
    </div>
  ` : '';

  container.innerHTML = `
    <div class="ts-result">
      <div class="ts-result-hd">
        <div style="display:flex;gap:10px;align-items:center;flex:1">
          ${logoHtml}
          <div class="ts-token-meta">
            <div class="ts-token-name">${name} <span class="ts-narrative">${narrative.emoji} ${narrative.tag}</span></div>
            <div class="ts-token-symbol">$${symbol}</div>
            <div class="ts-token-ca" onclick="navigator.clipboard.writeText('${mint}');this.textContent='Copied!';setTimeout(()=>this.textContent='${shortAddr(mint)}',1200)">${shortAddr(mint)}</div>
          </div>
        </div>
        <div class="ts-score-ring">
          <svg viewBox="0 0 64 64"><circle class="ts-score-ring-bg" cx="32" cy="32" r="26"/><circle class="ts-score-ring-fill" cx="32" cy="32" r="26" stroke="${ringColor}" stroke-dasharray="${strokeDash} ${circumference}" stroke-dashoffset="0"/></svg>
          <div class="ts-score-label"><span class="ts-score-num" style="color:${ringColor}">${alpha}</span><span class="ts-score-word" style="color:${ringColor}">${verdict.label.replace(/[🌙🔥✅⚖️⚠️🚨]/g,'').trim().split(' ')[0]}</span></div>
        </div>
        <span class="ts-verdict-badge" style="background:${verdict.bg};color:${verdict.color}">${verdict.label}</span>
      </div>

      <div class="ts-metrics">
        <div class="ts-metric"><div class="ts-metric-label">Price</div><div class="ts-metric-value">${fmtPrice(pair?.priceUsd)}</div></div>
        <div class="ts-metric"><div class="ts-metric-label">1H</div><div class="ts-metric-value ${pc1h>=0?'green':'red'}">${fmtPct(pc1h)}</div></div>
        <div class="ts-metric"><div class="ts-metric-label">6H</div><div class="ts-metric-value ${pc6h>=0?'green':'red'}">${fmtPct(pc6h)}</div></div>
        <div class="ts-metric"><div class="ts-metric-label">24H</div><div class="ts-metric-value ${pc24>=0?'green':'red'}">${fmtPct(pc24)}</div></div>
        <div class="ts-metric"><div class="ts-metric-label">Volume 24H</div><div class="ts-metric-value">${fmt$(vol24)}</div></div>
        <div class="ts-metric"><div class="ts-metric-label">Liquidity</div><div class="ts-metric-value">${fmt$(liq)}</div></div>
        <div class="ts-metric"><div class="ts-metric-label">Market Cap</div><div class="ts-metric-value">${fmt$(mc)}</div></div>
        <div class="ts-metric"><div class="ts-metric-label">Age</div><div class="ts-metric-value">${fmtAge(ageMs)}</div></div>
        <div class="ts-metric"><div class="ts-metric-label">Buys / Sells</div><div class="ts-metric-value"><span class="green">${buys}</span> / <span class="red">${sells}</span></div></div>
        <div class="ts-metric"><div class="ts-metric-label">DEX</div><div class="ts-metric-value" style="text-transform:capitalize">${pair?.dexId || '—'}</div></div>
      </div>

      <div class="ts-dims">
        ${Object.entries(dims).map(([k, v]) => `
          <div class="ts-dim">
            <span class="ts-dim-name">${k}</span>
            <div class="ts-dim-bar"><div class="ts-dim-fill" style="width:${v}%;background:${dimColor(v)}"></div></div>
            <span class="ts-dim-val">${v}</span>
          </div>
        `).join('')}
      </div>

      <div class="ts-flags">${flagHtml}</div>

      <div class="ts-report">
        <div class="ts-report-section">
          <div class="ts-report-title">Executive Summary</div>
          <div class="ts-report-body">${exec}</div>
        </div>

        ${bullPoints.length ? `
        <div class="ts-report-section">
          <div class="ts-report-title">Bull Case</div>
          <ul class="ts-report-bullets">${bullPoints.map(p => `<li>${p}</li>`).join('')}</ul>
        </div>` : ''}

        ${bearPoints.length ? `
        <div class="ts-report-section">
          <div class="ts-report-title">Bear Case / Risks</div>
          <ul class="ts-report-bullets">${bearPoints.map(p => `<li>${p}</li>`).join('')}</ul>
        </div>` : ''}

        ${tradeHtml}

        <div id="ts-meteora-section" class="ts-report-section">
          <div class="ts-report-title">◎ Meteora LP Opportunities</div>
          <div class="ts-loading" style="padding:12px 0"><div class="ts-spinner"></div>Checking Meteora pools…</div>
        </div>

        <div class="ts-report-section">
          <div class="ts-report-title">Links</div>
          <div class="ts-socials">${socialHtml}</div>
        </div>
      </div>
    </div>
  `;

  // Async: fetch Meteora pools and inject when ready
  if (mint) {
    fetchMeteoraLPPools(mint).then(pools => {
      const el = container.querySelector('#ts-meteora-section');
      if (el) el.outerHTML = renderMeteoraSection(pools, dims.momentum);
    });
  }
}

// ── AI Scan tab logic ──────────────────────────────────────────────────────
const scanBtn = document.getElementById('ts-scan-btn');
const caInput = document.getElementById('ts-ca-input');
const scanResult = document.getElementById('ts-scan-result');

async function runAiScan() {
  const query = caInput.value.trim();
  if (!query) return;
  scanBtn.disabled = true;
  scanBtn.textContent = 'Scanning…';
  scanResult.innerHTML = '<div class="ts-loading"><div class="ts-spinner"></div>Fetching token data…</div>';

  try {
    const pair = await fetchDexToken(query);
    const mint = pair?.baseToken?.address;
    scanResult.innerHTML = '<div class="ts-loading"><div class="ts-spinner"></div>Running safety checks…</div>';
    const rug = mint ? await fetchRugCheck(mint) : null;
    renderTokenCard(pair, rug, scanResult);
  } catch (e) {
    scanResult.innerHTML = `<div class="ts-empty">❌ ${e.message || 'Failed to fetch token data'}</div>`;
  } finally {
    scanBtn.disabled = false;
    scanBtn.textContent = 'Scan Token';
  }
}

scanBtn.addEventListener('click', runAiScan);
caInput.addEventListener('keydown', e => { if (e.key === 'Enter') runAiScan(); });

// ── Alpha Scanner tab logic ────────────────────────────────────────────────
let scannerRunning = false;
let scannerTimer = null;
let scannerCountdown = null;
let currentFilter = 'all';
let scannerData = [];
const SCAN_INTERVAL = 90; // seconds

const startBtn = document.getElementById('ts-start-btn');
const stopBtn = document.getElementById('ts-stop-btn');
const statusText = document.getElementById('ts-status-text');
const dot = document.getElementById('ts-dot');
const scannerBody = document.getElementById('ts-scanner-body');
const scannerDetail = document.getElementById('ts-scanner-detail');
const countdownEl = document.getElementById('ts-countdown');

function setScannerState(running) {
  scannerRunning = running;
  startBtn.disabled = running;
  stopBtn.disabled = !running;
  dot.className = 'ts-scanner-dot' + (running ? ' pulse' : ' idle');
}

// ── Snipe Window ─────────────────────────────────────────────────────────────
// Criteria: pool < 2h old · h1 change 20–500% · liq > $10K · buyers > sellers in 5m
function isInSnipeWindow(pair) {
  const ageMs  = pair?.pairCreatedAt ? Date.now() - pair.pairCreatedAt : null;
  if (!ageMs || ageMs > 2 * 3_600_000) return false;          // must be < 2h old
  const pc1h   = pair?.priceChange?.h1 ?? 0;
  if (pc1h < 20 || pc1h > 500) return false;                  // 20–500% gain in 1h
  const liq    = pair?.liquidity?.usd ?? 0;
  if (liq < 10_000) return false;                              // need real liquidity
  const m5     = pair?.txns?.m5 || {};
  if ((m5.buys || 0) <= (m5.sells || 0)) return false;        // buyers must dominate right now
  return true;
}

function renderSnipeWindow(pairs) {
  const snipeCards = document.getElementById('snipe-cards');
  const snipeCount = document.getElementById('snipe-count');
  if (!snipeCards) return;

  const hits = pairs.filter(isInSnipeWindow)
    .sort((a, b) => (b.priceChange?.h1 ?? 0) - (a.priceChange?.h1 ?? 0))
    .slice(0, 20);

  snipeCount.textContent = hits.length ? `${hits.length} live` : '0 now';

  if (!hits.length) {
    snipeCards.innerHTML = '<div class="snipe-empty">No tokens in snipe window right now — check back soon</div>';
    return;
  }

  snipeCards.innerHTML = hits.map(pair => {
    const name    = pair?.baseToken?.name || 'Unknown';
    const symbol  = pair?.baseToken?.symbol || '?';
    const mint    = pair?.baseToken?.address || '';
    const pc1h    = pair?.priceChange?.h1 ?? 0;
    const pc5m    = pair?.priceChange?.m5 ?? 0;
    const liq     = pair?.liquidity?.usd ?? 0;
    const vol5m   = pair?.volume?.m5 ?? 0;
    const m5      = pair?.txns?.m5 || {};
    const buys    = m5.buys || 0;
    const sells   = m5.sells || 0;
    const ageMs   = Date.now() - pair.pairCreatedAt;
    const ageMin  = Math.round(ageMs / 60_000);
    const pairAddr = pair?.pairAddress || '';

    // How far through the snipe window (0–100): age as % of 2h
    const windowPct = Math.min(100, (ageMs / (2 * 3_600_000)) * 100);
    // Bar color: green when fresh, amber as it ages
    const barColor  = windowPct < 50 ? '#4ADE80' : windowPct < 80 ? '#F59E0B' : '#F87171';
    // Hot = < 20 min old
    const isHot     = ageMin < 20;
    // Buy pressure %
    const total     = buys + sells;
    const buyPct    = total > 0 ? Math.round((buys / total) * 100) : 50;
    const pressureColor = buyPct >= 65 ? '#4ADE80' : '#F59E0B';

    const dsLink = `https://dexscreener.com/solana/${pairAddr}`;

    return `
      <div class="snipe-card${isHot ? ' snipe-card-hot' : ''}" onclick="window.open('${dsLink}','_blank')">
        <div class="snipe-card-name">${name}</div>
        <div class="snipe-card-symbol">$${symbol}</div>
        <span class="snipe-card-age${isHot ? ' snipe-card-age-hot' : ''}">${ageMin < 60 ? ageMin + 'm' : (ageMin/60).toFixed(1) + 'h'}</span>
        <div class="snipe-momentum${pc1h > 300 ? ' warn' : ''}">+${pc1h.toFixed(0)}% <span style="font-size:10px;font-weight:500;color:var(--tx-3)">1H</span></div>
        <div class="snipe-card-row">
          <span class="snipe-card-label">5m move</span>
          <span class="snipe-card-val" style="color:${pc5m>=0?'#4ADE80':'#F87171'}">${pc5m>=0?'+':''}${pc5m.toFixed(1)}%</span>
        </div>
        <div class="snipe-card-row">
          <span class="snipe-card-label">Liq</span>
          <span class="snipe-card-val">${fmt$(liq)}</span>
        </div>
        <div class="snipe-card-row">
          <span class="snipe-card-label">Vol 5m</span>
          <span class="snipe-card-val">${fmt$(vol5m)}</span>
        </div>
        <div class="snipe-bar"><div class="snipe-bar-fill" style="width:${windowPct.toFixed(0)}%;background:${barColor}"></div></div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="snipe-pressure" style="color:${pressureColor}">${buyPct}% buys</span>
          <a class="snipe-card-link" href="${dsLink}" target="_blank" onclick="event.stopPropagation()">Chart →</a>
        </div>
      </div>`;
  }).join('');
}

async function runAlphaScan() {
  setScannerState(true);
  statusText.textContent = 'Scanning trending Solana tokens…';
  try {
    const [boosts, profiles] = await Promise.all([
      fetchTrendingSolana().catch(() => []),
      fetchNewProfiles().catch(() => []),
    ]);
    const addresses = new Set();
    const combined = [...boosts, ...profiles];
    const unique = combined.filter(t => {
      const addr = t.tokenAddress || t.baseToken?.address;
      if (!addr || addresses.has(addr)) return false;
      addresses.add(addr);
      return true;
    }).slice(0, 25);

    statusText.textContent = `Analyzing ${unique.length} tokens…`;

    const results = [];
    const allPairs = [];
    for (const t of unique) {
      try {
        const addr = t.tokenAddress || t.baseToken?.address;
        if (!addr) continue;
        const pair = await fetchDexToken(addr);
        if (!pair) continue;
        allPairs.push(pair);
        const rug = await fetchRugCheck(addr);
        const scores = scoreToken(pair, rug);
        results.push({ pair, rug, scores, addr });
      } catch { /* skip failed tokens */ }
    }

    renderSnipeWindow(allPairs);
    results.sort((a, b) => b.scores.alpha - a.scores.alpha);
    scannerData = results;
    renderScannerTable();
    statusText.textContent = `Last scan: ${new Date().toLocaleTimeString()} · ${results.length} tokens analyzed`;
    startCountdown();
  } catch (e) {
    statusText.textContent = `Error: ${e.message}`;
  }
}

function startCountdown() {
  let remaining = SCAN_INTERVAL;
  clearInterval(scannerCountdown);
  scannerCountdown = setInterval(() => {
    remaining--;
    countdownEl.textContent = `Next scan in ${remaining}s`;
    if (remaining <= 0) {
      clearInterval(scannerCountdown);
      countdownEl.textContent = '';
      if (scannerRunning) runAlphaScan();
    }
  }, 1000);
}

function renderScannerTable() {
  const filtered = scannerData.filter(({ scores, pair }) => {
    if (currentFilter === 'all') return true;
    const v = verdictFromScore(scores.alpha);
    if (currentFilter === 'moonshot') return v.tier === 'moonshot';
    if (currentFilter === 'conviction') return v.tier === 'conviction';
    if (currentFilter === 'bullish') return v.tier === 'bullish';
    if (currentFilter === 'avoid') return ['avoid','caution'].includes(v.tier);
    return true;
  });

  if (!filtered.length) {
    scannerBody.innerHTML = '<tr><td colspan="11" class="ts-empty">No tokens match this filter</td></tr>';
    return;
  }

  scannerBody.innerHTML = filtered.map(({ pair, rug, scores, addr }, i) => {
    const { alpha, dims, flags, narrative } = scores;
    const verdict = verdictFromScore(alpha);
    const name = pair?.baseToken?.name || 'Unknown';
    const symbol = pair?.baseToken?.symbol || '?';
    const pc24 = pair?.priceChange?.h24 || 0;
    const vol24 = pair?.volume?.h24 || 0;
    const liq = pair?.liquidity?.usd || 0;
    const mc = pair?.marketCap || pair?.fdv || 0;
    const ageMs = pair?.pairCreatedAt ? Date.now() - pair.pairCreatedAt : 0;

    const scoreBg = alpha >= 65 ? '#A78BFA' : alpha >= 50 ? '#4ADE80' : alpha >= 35 ? '#F59E0B' : '#F87171';
    const safetyColor = dims.safety >= 70 ? '#4ADE80' : dims.safety >= 40 ? '#F59E0B' : '#F87171';

    return `
      <tr data-idx="${i}" onclick="toggleScanDetail(${i}, this)">
        <td><span class="ts-score-pill" style="background:${scoreBg}22;color:${scoreBg}">${alpha}</span></td>
        <td class="bold">${name}<br><span style="color:var(--tx-3);font-size:9px">$${symbol}</span></td>
        <td><span class="ts-narrative">${narrative.emoji} ${narrative.tag}</span></td>
        <td class="mono">${fmtPrice(pair?.priceUsd)}</td>
        <td class="mono ${pc24>=0?'green':'red'}">${fmtPct(pc24)}</td>
        <td class="mono">${fmt$(vol24)}</td>
        <td class="mono">${fmt$(liq)}</td>
        <td class="mono">${fmt$(mc)}</td>
        <td class="mono">${fmtAge(ageMs)}</td>
        <td><span style="color:${safetyColor};font-size:10px;font-weight:700">${dims.safety}</span></td>
        <td><span class="ts-verdict-dot" style="background:${verdict.color}"></span><span style="font-size:10px;color:${verdict.color}">${verdict.label.replace(/[^\w\s]/g,'').trim()}</span></td>
      </tr>
      <tr class="ts-scan-expand" id="ts-expand-${i}">
        <td colspan="11"><div class="ts-scan-expand-inner" id="ts-expand-inner-${i}">
          <div class="ts-loading"><div class="ts-spinner"></div>Loading full analysis…</div>
        </div></td>
      </tr>
    `;
  }).join('');
}

function toggleScanDetail(idx, row) {
  const expandRow = document.getElementById(`ts-expand-${idx}`);
  const inner = document.getElementById(`ts-expand-inner-${idx}`);
  const isOpen = expandRow.classList.contains('is-open');
  // Close all
  document.querySelectorAll('.ts-scan-expand.is-open').forEach(r => r.classList.remove('is-open'));
  if (!isOpen) {
    expandRow.classList.add('is-open');
    const { pair, rug } = scannerData[idx];
    renderTokenCard(pair, rug, inner);
  }
}
window.toggleScanDetail = toggleScanDetail;

startBtn.addEventListener('click', () => {
  runAlphaScan();
});

stopBtn.addEventListener('click', () => {
  setScannerState(false);
  clearInterval(scannerCountdown);
  clearInterval(scannerTimer);
  countdownEl.textContent = '';
  statusText.textContent = 'Scanner stopped';
});

// Alpha Scanner filter chips
document.querySelectorAll('[data-filter]').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach(c => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    currentFilter = chip.dataset.filter;
    renderScannerTable();
  });
});

// ── DLMM Scanner ───────────────────────────────────────────────────────────
let dlmmRunning = false;
let dlmmCountdownTimer = null;
let dlmmData = [];
let dlmmSortedData = [];   // tracks current sorted view for correct row→pool lookup
let dlmmSortKey = 'score';
let dlmmMinTvl = 10000;
const DLMM_INTERVAL = 60;

const dlmmStartBtn = document.getElementById('dlmm-start-btn');
const dlmmStopBtn  = document.getElementById('dlmm-stop-btn');
const dlmmStatusEl = document.getElementById('dlmm-status-text');
const dlmmDot      = document.getElementById('dlmm-dot');
const dlmmBody     = document.getElementById('dlmm-body');
const dlmmCountEl  = document.getElementById('dlmm-countdown');

function setDlmmState(running) {
  dlmmRunning = running;
  dlmmStartBtn.disabled = running;
  dlmmStopBtn.disabled = !running;
  dlmmDot.className = 'ts-scanner-dot' + (running ? ' pulse' : ' idle');
}

function fmtFee(n) {
  if (!n || isNaN(n)) return '$—';
  if (n >= 1000) return '$' + (n/1000).toFixed(1) + 'K';
  if (n >= 1)    return '$' + n.toFixed(2);
  if (n >= 0.01) return '$' + n.toFixed(3);
  return '<$0.01';
}

function dlmmFeesFromPair(pair) {
  const feeRate = parseFloat(estimateFeeTier(pair)) / 100;
  const v = pair.volume || {};
  return {
    m5:  (v.m5  || 0) * feeRate,
    h1:  (v.h1  || 0) * feeRate,
    h12: (v.h24 || 0) / 2 * feeRate,
    h24: (v.h24 || 0) * feeRate,
    rate: feeRate,
  };
}

function dlmmTrend(pair) {
  const vol5m = pair.volume?.m5 || 0;
  const vol1h = pair.volume?.h1 || 0;
  if (!vol1h) return 'flat';
  const extrap = vol5m * 12; // 5m → projected 1h
  const ratio  = extrap / vol1h;
  if (ratio > 1.4) return 'up';
  if (ratio < 0.6) return 'down';
  return 'flat';
}

function dlmmAgeClass(ageH) {
  if (ageH < 6)   return { cls: 'dlmm-age-new',  label: ageH < 1 ? '<1h NEW' : fmtAge(ageH * 3_600_000) + ' NEW' };
  if (ageH < 72)  return { cls: 'dlmm-age-good', label: fmtAge(ageH * 3_600_000) };
  return               { cls: 'dlmm-age-old',  label: fmtAge(ageH * 3_600_000) };
}

function scoreDlmmPool(pair) {
  const tvl    = pair.liquidity?.usd || 0;
  const vol24  = pair.volume?.h24    || 0;
  const fees   = dlmmFeesFromPair(pair);
  const ageMs  = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : 0;
  const ageH   = ageMs / 3_600_000;
  const feeApr = tvl > 0 ? (fees.h24 * 365 / tvl * 100) : 0;
  const volTvl = tvl > 0 ? vol24 / tvl : 0;
  const trend  = dlmmTrend(pair);
  const quote  = (pair.quoteToken?.symbol || '').toUpperCase();

  // APR component (0–40)
  let aprScore = feeApr > 500 ? 40 : feeApr > 200 ? 34 : feeApr > 75 ? 27 :
                 feeApr > 30  ? 19 : feeApr > 10  ? 12 : 4;

  // Vol/TVL efficiency (0–25)
  let effScore = volTvl > 10 ? 25 : volTvl > 5 ? 20 : volTvl > 2 ? 16 :
                 volTvl > 1  ? 12 : volTvl > 0.3 ? 7 : 2;

  // Age sweet spot (0–15): 6h–48h is ideal
  let ageScore = ageH < 1 ? 5 : ageH < 6 ? 10 : ageH < 48 ? 15 :
                 ageH < 168 ? 10 : 5;

  // Momentum (0–20)
  let momentumScore = trend === 'up' ? 20 : trend === 'flat' ? 10 : 3;

  // IL consideration: token/token pairs get small penalty
  let ilPenalty = /USDC|USDT|USDS/.test(quote) ? 0 :
                  /SOL|WSOL/.test(quote)         ? 0 : 5;

  const total = Math.max(0, Math.min(100, aprScore + effScore + ageScore + momentumScore - ilPenalty));
  return { total, aprScore, effScore, ageScore, momentumScore, feeApr, volTvl, trend, fees, ageH, ilPenalty };
}

function generateDlmmReasoning(pair, sc) {
  const quote = (pair.quoteToken?.symbol || '').toUpperCase();
  const base  = pair.baseToken?.symbol || '?';
  const { feeApr, volTvl, trend, fees, ageH } = sc;
  const buys1h  = pair.txns?.h1?.buys  || 0;
  const sells1h = pair.txns?.h1?.sells || 0;
  const items = [];

  // Fee yield
  if (feeApr > 200) items.push({ icon: '🔥', text: `${feeApr.toFixed(0)}% fee APR — top-tier yield. Every $1K LP earns ~${fmtFee(feeApr / 365 * 10)}/day` });
  else if (feeApr > 50) items.push({ icon: '✅', text: `${feeApr.toFixed(0)}% fee APR — strong yield, competitive with top DeFi pools` });
  else if (feeApr > 10) items.push({ icon: '📊', text: `${feeApr.toFixed(0)}% fee APR — moderate yield, suitable for lower-risk LPs` });
  else items.push({ icon: '⚠️', text: `${feeApr.toFixed(1)}% fee APR — low yield. Consider other pools unless TVL is very stable` });

  // Efficiency
  if (volTvl > 5) items.push({ icon: '⚡', text: `${volTvl.toFixed(1)}× vol/TVL — exceptional capital efficiency. Volume massively outpaces liquidity depth` });
  else if (volTvl > 1) items.push({ icon: '📈', text: `${volTvl.toFixed(1)}× vol/TVL — healthy activity. Daily volume exceeds total TVL` });
  else items.push({ icon: '💤', text: `${volTvl.toFixed(2)}× vol/TVL — low turnover. Pool is underutilised relative to its liquidity` });

  // Volume trend
  const vol5mRate = (pair.volume?.m5 || 0) * 12;
  const vol1h     = pair.volume?.h1 || 0;
  if (trend === 'up')   items.push({ icon: '🚀', text: `Volume accelerating — recent 5m pace extrapolates to ${fmt$(vol5mRate)}/hr vs ${fmt$(vol1h)}/hr 1H avg. Fees picking up` });
  else if (trend === 'down') items.push({ icon: '❄️', text: `Volume cooling — recent 5m pace (${fmt$(vol5mRate)}/hr) well below 1H avg (${fmt$(vol1h)}/hr). Fees may slow` });
  else items.push({ icon: '➡️', text: `Volume stable — 5m pace tracking close to 1H average. Consistent fee generation` });

  // Age context
  if (ageH < 2)       items.push({ icon: '⚡', text: `Brand new pool (${ageH.toFixed(1)}h) — extremely early. Very high fee potential but also highest rug/dump risk. Do NOT size large` });
  else if (ageH < 24) items.push({ icon: '🌱', text: `Fresh pool (${ageH.toFixed(1)}h old) — past the initial dump window, still in high-fee momentum phase` });
  else if (ageH < 72) items.push({ icon: '⏱️', text: `Pool is ${ageH.toFixed(1)}h old — prime LP window. Survived early volatility, fees still elevated` });
  else                items.push({ icon: 'ℹ️', text: `Mature pool (${(ageH/24).toFixed(1)}d old) — stable fees but early high-APR phase has likely passed` });

  // IL context
  if (/SOL|WSOL/.test(quote)) items.push({ icon: '🛡️', text: `${base}/SOL pair — correlated assets reduce IL. SOL tends to move with meme tokens, limiting divergence loss` });
  else if (/USDC|USDT/.test(quote)) items.push({ icon: '⚖️', text: `${base}/USDC pair — maximum IL. Any price move creates divergence loss. Only LP here if expecting sideways price action` });
  else items.push({ icon: '🎲', text: `Token/token pair — high IL risk from both assets. Best for small experimental positions only` });

  // Buy/sell pressure
  if (buys1h + sells1h > 10) {
    const bsPct = Math.round(buys1h / (buys1h + sells1h) * 100);
    if (bsPct > 60) items.push({ icon: '🟢', text: `${bsPct}% buy pressure last hour (${buys1h}B / ${sells1h}S) — net long flow, price stable or rising, favourable for LP` });
    else if (bsPct < 40) items.push({ icon: '🔴', text: `${100-bsPct}% sell pressure last hour (${sells1h}S / ${buys1h}B) — selling dominates, IL risk elevated` });
  }

  return items;
}

function renderDlmmExpanded(pair, sc, container) {
  const fees   = sc.fees;
  const ageMs  = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : 0;
  const created = pair.pairCreatedAt ? new Date(pair.pairCreatedAt) : null;
  const reasons = generateDlmmReasoning(pair, sc);
  const pairAddr = pair.pairAddress || '';
  const metLink  = pairAddr ? `https://app.meteora.ag/dlmm/${pairAddr}` : 'https://app.meteora.ag/pools';

  // Biggest fee bar = h12, scale others to it
  const maxFee = Math.max(fees.m5, fees.h1, fees.h12) || 1;
  const barColor = (f) => f / maxFee > 0.6 ? '#4ADE80' : f / maxFee > 0.3 ? '#F59E0B' : '#94A3B8';

  container.innerHTML = `
    <div class="dlmm-expand-inner">
      <div class="dlmm-detail-section">
        <div class="dlmm-detail-title">Fee Breakdown</div>
        <div class="dlmm-fee-bars">
          <div class="dlmm-fee-bar-row">
            <span class="dlmm-fee-bar-label">5m</span>
            <div class="dlmm-fee-bar-track"><div class="dlmm-fee-bar-fill" style="width:${fees.m5/maxFee*100}%;background:${barColor(fees.m5)}"></div></div>
            <span class="dlmm-fee-bar-val">${fmtFee(fees.m5)}</span>
          </div>
          <div class="dlmm-fee-bar-row">
            <span class="dlmm-fee-bar-label">1H</span>
            <div class="dlmm-fee-bar-track"><div class="dlmm-fee-bar-fill" style="width:${fees.h1/maxFee*100}%;background:${barColor(fees.h1)}"></div></div>
            <span class="dlmm-fee-bar-val">${fmtFee(fees.h1)}</span>
          </div>
          <div class="dlmm-fee-bar-row">
            <span class="dlmm-fee-bar-label">12H</span>
            <div class="dlmm-fee-bar-track"><div class="dlmm-fee-bar-fill" style="width:${fees.h12/maxFee*100}%;background:${barColor(fees.h12)}"></div></div>
            <span class="dlmm-fee-bar-val">${fmtFee(fees.h12)}</span>
          </div>
        </div>
        <div class="dlmm-open-time">
          <div class="dlmm-open-time-item">
            <label>Pool Opened</label>
            <span>${created ? created.toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'}</span>
          </div>
          <div class="dlmm-open-time-item">
            <label>Age</label>
            <span>${fmtAge(ageMs)}</span>
          </div>
          <div class="dlmm-open-time-item">
            <label>Fee Rate (est.)</label>
            <span>${(sc.fees.rate * 100).toFixed(2)}%</span>
          </div>
          <div class="dlmm-open-time-item">
            <label>Vol/TVL</label>
            <span>${sc.volTvl.toFixed(2)}×</span>
          </div>
        </div>
        <a class="dlmm-action-btn" href="${metLink}" target="_blank" rel="noopener">
          ◎ Open in Meteora →
        </a>
      </div>
      <div class="dlmm-detail-section">
        <div class="dlmm-detail-title">Why This Pool</div>
        <div class="dlmm-reasoning">
          ${reasons.map(r => `<div class="dlmm-reason-item"><span class="dlmm-reason-icon">${r.icon}</span><span>${r.text}</span></div>`).join('')}
        </div>
      </div>
    </div>
  `;
}

async function fetchDlmmPools(minTvl) {
  // Multi-search strategy: parallel queries across known active Solana tokens
  // DexScreener search returns pairs matching the token symbol/name
  const SEARCH_TERMS = [
    'JUP','BONK','POPCAT','DRIFT','JTO','TRUMP','PYTH','RAY',
    'PENGU','GOAT','MOODENG','CHILLGUY','PNUT','AI16Z','FWOG','ZEREBRO',
    'BARSIK','GRIFFAIN','ALCH','SWARMS',
  ];

  const searches = await Promise.all(
    SEARCH_TERMS.map(q =>
      fetch(`${DS_BASE}/latest/dex/search/?q=${q}`)
        .then(r => r.json())
        .then(d => (d.pairs || []).filter(p =>
          p.chainId === 'solana' &&
          (p.dexId === 'meteora' || p.dexId === 'meteoradlmm') &&
          (p.liquidity?.usd || 0) >= minTvl &&
          (p.volume?.h24 || 0) > 0
        ))
        .catch(() => [])
    )
  );

  // Also pull boosted token mints and batch-fetch their Meteora pairs
  const boostPairs = await fetchTrendingSolana()
    .then(boosts => {
      const addrs = [...new Set(boosts.map(t => t.tokenAddress).filter(Boolean))].slice(0, 28);
      if (!addrs.length) return [];
      return fetch(`${DS_BASE}/latest/dex/tokens/${addrs.join(',')}`)
        .then(r => r.json())
        .then(d => (d.pairs || []).filter(p =>
          p.chainId === 'solana' &&
          (p.dexId === 'meteora' || p.dexId === 'meteoradlmm') &&
          (p.liquidity?.usd || 0) >= minTvl
        ));
    })
    .catch(() => []);

  // Deduplicate by pairAddress
  const seen = new Set();
  const all = [...searches.flat(), ...boostPairs];
  return all.filter(p => {
    if (seen.has(p.pairAddress)) return false;
    seen.add(p.pairAddress);
    return true;
  });
}

function renderDlmmTable() {
  const sorted = dlmmSortedData = [...dlmmData].sort((a, b) => {
    if (dlmmSortKey === 'score')    return b.sc.total     - a.sc.total;
    if (dlmmSortKey === 'fee_apr')  return b.sc.feeApr    - a.sc.feeApr;
    if (dlmmSortKey === 'fees_1h')  return b.sc.fees.h1   - a.sc.fees.h1;
    if (dlmmSortKey === 'vol_tvl')  return b.sc.volTvl    - a.sc.volTvl;
    return 0;
  });

  if (!sorted.length) {
    dlmmBody.innerHTML = '<tr><td colspan="11" class="ts-empty">No Meteora DLMM pools found above the TVL threshold</td></tr>';
    return;
  }

  dlmmBody.innerHTML = sorted.map((item, i) => {
    const { pair, sc } = item;
    const base   = pair.baseToken?.symbol  || '?';
    const quote  = pair.quoteToken?.symbol || '?';
    const tvl    = pair.liquidity?.usd     || 0;
    const ageMs  = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : 0;
    const age    = dlmmAgeClass(ageMs / 3_600_000);
    const trend  = sc.trend;
    const trendEl = trend === 'up'   ? '<span class="dlmm-trend-up">▲</span>' :
                    trend === 'down' ? '<span class="dlmm-trend-down">▼</span>' :
                                       '<span class="dlmm-trend-flat">→</span>';
    const scoreColor = sc.total >= 70 ? '#A78BFA' : sc.total >= 50 ? '#4ADE80' : sc.total >= 35 ? '#F59E0B' : '#F87171';
    const feeClass = (f, ref) => f > ref * 1.4 ? 'hot' : f > ref * 0.5 ? 'warm' : 'cold';

    return `
      <tr data-dlmm-idx="${i}" onclick="toggleDlmmDetail(${i},this)">
        <td style="color:var(--tx-3);font-size:10px">${i+1}</td>
        <td style="font-weight:700;color:var(--tx-1)">${base}<span style="color:var(--tx-3);font-weight:400">/${quote}</span></td>
        <td><span class="dlmm-age-pill ${age.cls}">${age.label}</span></td>
        <td class="mono">${fmt$(tvl)}</td>
        <td class="dlmm-fee-cell ${feeClass(sc.fees.m5, sc.fees.h1/12)}">${fmtFee(sc.fees.m5)}</td>
        <td class="dlmm-fee-cell ${feeClass(sc.fees.h1, sc.fees.h12/12)}">${fmtFee(sc.fees.h1)}</td>
        <td class="dlmm-fee-cell warm">${fmtFee(sc.fees.h12)}</td>
        <td class="mono" style="color:var(--ac);font-weight:700">${sc.feeApr > 9999 ? '>9999%' : sc.feeApr.toFixed(0) + '%'}</td>
        <td class="mono" style="color:${sc.volTvl > 2 ? '#4ADE80' : sc.volTvl > 0.5 ? '#F59E0B' : '#F87171'}">${sc.volTvl.toFixed(1)}×</td>
        <td>${trendEl}</td>
        <td><span style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;color:${scoreColor}">${sc.total}</span></td>
      </tr>
      <tr class="dlmm-expand-row" id="dlmm-exp-${i}">
        <td colspan="11"><div id="dlmm-exp-inner-${i}"></div></td>
      </tr>
    `;
  }).join('');
}

function toggleDlmmDetail(idx, row) {
  const expRow   = document.getElementById(`dlmm-exp-${idx}`);
  const inner    = document.getElementById(`dlmm-exp-inner-${idx}`);
  const isOpen   = expRow.classList.contains('is-open');
  // Close all expanded rows
  document.querySelectorAll('.dlmm-expand-row.is-open').forEach(r => r.classList.remove('is-open'));
  document.querySelectorAll('.dlmm-table tbody tr.is-expanded').forEach(r => r.classList.remove('is-expanded'));
  if (!isOpen) {
    expRow.classList.add('is-open');
    row.classList.add('is-expanded');
    const { pair, sc } = dlmmSortedData[idx] || {};
    if (pair && sc) renderDlmmExpanded(pair, sc, inner);
  }
}
window.toggleDlmmDetail = toggleDlmmDetail;

async function runDlmmScan() {
  setDlmmState(true);
  dlmmStatusEl.textContent = 'Fetching trending Solana tokens…';
  try {
    dlmmStatusEl.textContent = 'Scanning Meteora DLMM pools…';
    const pairs = await fetchDlmmPools(dlmmMinTvl);
    dlmmData = pairs.map(pair => ({ pair, sc: scoreDlmmPool(pair) }));
    renderDlmmTable();
    dlmmStatusEl.textContent = `Found ${dlmmData.length} Meteora pools · Last scan ${new Date().toLocaleTimeString()}`;
    startDlmmCountdown();
  } catch (e) {
    dlmmStatusEl.textContent = `Error: ${e.message}`;
    setDlmmState(false);
  }
}

function startDlmmCountdown() {
  let rem = DLMM_INTERVAL;
  clearInterval(dlmmCountdownTimer);
  dlmmCountEl.textContent = `Next refresh in ${rem}s`;
  dlmmCountdownTimer = setInterval(() => {
    rem--;
    dlmmCountEl.textContent = `Next refresh in ${rem}s`;
    if (rem <= 0) {
      clearInterval(dlmmCountdownTimer);
      dlmmCountEl.textContent = '';
      if (dlmmRunning) runDlmmScan();
    }
  }, 1000);
}

dlmmStartBtn.addEventListener('click', runDlmmScan);
dlmmStopBtn.addEventListener('click', () => {
  setDlmmState(false);
  clearInterval(dlmmCountdownTimer);
  dlmmCountEl.textContent = '';
  dlmmStatusEl.textContent = 'Scanner stopped';
});

// DLMM sort chips
document.querySelectorAll('[data-dlmm-sort]').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('[data-dlmm-sort]').forEach(c => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    dlmmSortKey = chip.dataset.dlmmSort;
    renderDlmmTable();
  });
});

// DLMM TVL filter chips
document.querySelectorAll('[data-dlmm-tvl]').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('[data-dlmm-tvl]').forEach(c => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    dlmmMinTvl = parseInt(chip.dataset.dlmmTvl);
    if (dlmmData.length) renderDlmmTable();
  });
});

// ── Tab switching ──────────────────────────────────────────────────────────
document.querySelectorAll('.ts-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.ts-tab').forEach(t => t.classList.remove('is-active'));
    document.querySelectorAll('.ts-panel').forEach(p => p.classList.remove('is-active'));
    tab.classList.add('is-active');
    document.getElementById(`ts-panel-${tab.dataset.tab}`).classList.add('is-active');
  });
});
