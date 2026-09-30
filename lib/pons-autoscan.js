"use strict";
/**
 * pons-autoscan.js
 * Scans Pons launchpad on Robinhood Chain for recently graduated tokens.
 * Pons is an EVM-based launchpad (Robinhood Chain) — different from Solana/Pump.fun.
 *
 * Graduation = token cleared the bonding curve threshold (4.2 ETH) and moved
 * to a live DEX pool on Robinhood Chain.
 *
 * Called from api/cron-scan.js on each cron tick.
 */

const PONS_API       = "https://www.ponsfamily.com/api/pons-launches";
const COOLDOWN_MS    = 6 * 60 * 60 * 1000;   // 6h per token
const MAX_GRAD_AGE_MS = 2 * 60 * 60 * 1000;  // only alert tokens graduated within last 2h
const MAX_TOKENS      = 100;

function defaultState() {
  return { alerts: {}, tokens: [], lastScan: 0 };
}

async function fetchPonsGraduates() {
  try {
    const url = `${PONS_API}?sort=newest&graduated=true&page=1&pageSize=50&v=22`;
    const r   = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data) ? data.filter(t => t.graduated && t.token) : [];
  } catch { return []; }
}

// ── Discord alert ─────────────────────────────────────────

async function sendPonsAlert(webhook, token) {
  if (!webhook) return;
  const sym  = token.symbol || token.name || token.token.slice(0, 8);
  const mc   = token.marketCapUsd  ? `$${Number(token.marketCapUsd).toLocaleString()}`  : "—";
  const pr   = token.priceUsd      ? `$${parseFloat(token.priceUsd).toExponential(3)}`  : "—";
  const age  = token.age_minutes   != null ? `${token.age_minutes}m` : "—";
  const pool = token.pool && token.pool !== "0x0000000000000000000000000000000000000000"
    ? `[Pool](https://robinhood.com)` : "—";

  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        title: `🤖 ${sym} — Pons Graduate (Robinhood Chain)`,
        url: `https://www.ponsfamily.com/launchpad`,
        color: 0xa78bfa,
        description: `Graduated from Pons bonding curve ${age} ago`,
        fields: [
          { name: "Contract (EVM)",    value: `\`${token.token}\``,     inline: false },
          { name: "Price at Grad",     value: pr,                        inline: true  },
          { name: "MC at Grad",        value: mc,                        inline: true  },
          { name: "Age Since Grad",    value: age,                       inline: true  },
          { name: "Deployer",          value: `\`${token.deployer}\``,   inline: false },
        ],
        footer: { text: "Soloris · MemeScreener · Pons / Robinhood Chain" },
        timestamp: new Date().toISOString(),
      }],
    }),
  });
}

// ── Main scan ─────────────────────────────────────────────

async function runPonsAutoScan(state, { webhook } = {}) {
  const now     = Date.now();
  const summary = { checked: 0, qualified: 0, alerted: 0, errors: [] };

  const graduates = await fetchPonsGraduates();
  summary.checked = graduates.length;

  for (const grad of graduates) {
    const graduatedAt = grad.graduatedAt ? new Date(grad.graduatedAt).getTime() : null;
    if (!graduatedAt) continue;

    const ageMs = now - graduatedAt;
    if (ageMs > MAX_GRAD_AGE_MS) continue;   // skip if graduated more than 2h ago

    const ca = grad.token.toLowerCase();

    // Cooldown
    const lastAlerted = state.alerts?.[ca] || 0;
    if (now - lastAlerted < COOLDOWN_MS) continue;

    summary.qualified++;

    const ageMin = Math.floor(ageMs / 60000);

    const token = {
      id:             `pons_${ca}_${now}`,
      chain:          "robinhood",
      source:         "pons",
      token:          grad.token,
      deployer:       grad.deployer || null,
      pool:           grad.pool     || null,
      name:           grad.name     || grad.symbol || ca.slice(0, 8),
      symbol:         grad.symbol   || "?",
      priceUsd:       grad.priceUsd       ?? null,
      detected_price: grad.priceUsd       ?? null,
      detected_mc:    grad.marketCapUsd   ?? null,
      marketCapUsd:   grad.marketCapUsd   ?? null,
      age_minutes:    ageMin,
      graduatedAt,
      detectedAt:     now,
      milestones_hit: [],
    };

    state.tokens = [token, ...(state.tokens || []).filter(t => t.token !== ca)].slice(0, MAX_TOKENS);
    state.alerts = state.alerts || {};
    state.alerts[ca] = now;

    try {
      await sendPonsAlert(webhook, token);
      summary.alerted++;
    } catch (e) {
      summary.errors.push(e.message);
    }
  }

  state.lastScan = now;

  // Prune stale cooldowns
  const cutoff = now - 24 * 60 * 60 * 1000;
  for (const [ca, ts] of Object.entries(state.alerts || {})) {
    if (ts < cutoff) delete state.alerts[ca];
  }

  return summary;
}

module.exports = { runPonsAutoScan, defaultState };
