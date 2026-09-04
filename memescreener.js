"use strict";
// ── Scoring Engine ────────────────────────────────────────

function scoreContractSafety(d) {
  const allNull = d.mint_authority_revoked == null && d.freeze_authority_revoked == null && d.lp_locked_or_burned == null;
  if (allNull) return null;
  const all = d.mint_authority_revoked && d.freeze_authority_revoked && d.lp_locked_or_burned;
  if (all) return 2;
  const none = !d.mint_authority_revoked && !d.freeze_authority_revoked && !d.lp_locked_or_burned;
  if (none) return 0;
  return 1;
}

function scoreDistributionSafety(d) {
  if (d.top10_holder_pct == null && d.connected_cluster_pct == null) return null;
  const t10 = d.top10_holder_pct;
  const cc  = d.connected_cluster_pct;
  if ((t10 != null && t10 > 40) || (cc != null && cc > 40)) return 0;
  if ((t10 == null || t10 < 20) && (cc == null || cc < 20)) return 2;
  return 1;
}

function scoreDevHistory(d) {
  if (d.dev_previous_rug_flags == null && d.dev_previous_tokens_count == null) return null;
  if (d.dev_previous_rug_flags != null && d.dev_previous_rug_flags > 0) return 0;
  if (d.dev_previous_tokens_count != null && d.dev_previous_tokens_count > 0 && d.dev_previous_rug_flags === 0) return 2;
  return 1;
}

function scoreVolumeAuthenticity(d) {
  if (d.pct_volume_from_top10_wallets == null && d.unique_buyer_count == null) return null;
  const pct = d.pct_volume_from_top10_wallets;
  const buyers = d.unique_buyer_count;
  if (pct != null && pct > 80) return 0;
  if (buyers != null && buyers < 20 && d.volume_24h_usd != null && d.volume_24h_usd > 50000) return 0;
  if (pct != null && pct < 30) return 2;
  if (pct != null && pct <= 60) return 1;
  return 1;
}

function scoreCopycat(d) {
  if (d.is_name_copycat == null) return null;
  return d.is_name_copycat ? 0 : 2;
}

function scoreSocial(d) {
  const t = d.social_mention_velocity_trend;
  if (!t || t === "unknown") return null;
  if (t === "rising_faster_than_price") return 2;
  if (t === "tracking_price") return 1;
  if (t === "flat_or_falling_while_price_rises") return 0;
  return null;
}

function scoreKolIndependence(d) {
  if (!d.promoted_by_kol) return 2;
  if (d.kol_known_large_holder || d.kol_on_disclosed_paid_promo_list) return 0;
  return 1;
}

function buildSummary(result) {
  const { classification, sub_scores, forced_high_risk, token, composite_score } = result;
  const lines = [];

  if (forced_high_risk) {
    const triggers = [];
    if (sub_scores.distribution_safety === 0) triggers.push("extreme holder concentration");
    if (sub_scores.dev_history === 0) triggers.push("dev rug history");
    lines.push(`${token} is force-classified as High Risk due to ${triggers.join(" and ")}, overriding all other scores.`);
  } else {
    lines.push(`${token} scores ${(composite_score * 100).toFixed(0)}% composite — classified as "${classification}".`);
  }

  const reds = Object.entries(sub_scores).filter(([,v]) => v === 0).map(([k]) => k.replace(/_/g," "));
  const yellows = Object.entries(sub_scores).filter(([,v]) => v === 1).map(([k]) => k.replace(/_/g," "));
  if (reds.length) lines.push(`Red flags: ${reds.join(", ")}.`);
  if (yellows.length) lines.push(`Cautions: ${yellows.join(", ")}.`);

  if (result.data?.promoted_by_kol) {
    lines.push("KOL involvement detected — manually verify the post timing relative to price action; do not treat this as a positive signal.");
  }

  lines.push("This tool screens documented failure patterns only — it cannot detect novel scams or predict price.");
  return lines.join(" ");
}

function computeResult(token, data) {
  const sub_scores = {
    contract_safety:       scoreContractSafety(data),
    distribution_safety:   scoreDistributionSafety(data),
    dev_history:           scoreDevHistory(data),
    volume_authenticity:   scoreVolumeAuthenticity(data),
    copycat_check:         scoreCopycat(data),
    social_pattern:        scoreSocial(data),
    kol_independence:      scoreKolIndependence(data),
  };

  const nonNull = Object.values(sub_scores).filter(v => v !== null);
  const totalFields = Object.keys(sub_scores).length;
  const nullCount = totalFields - nonNull.length;
  const composite_score = nonNull.length ? nonNull.reduce((s, v) => s + v, 0) / (2 * nonNull.length) : null;

  const forced_high_risk = sub_scores.distribution_safety === 0 || sub_scores.dev_history === 0;

  let classification;
  if (nullCount > totalFields / 2) {
    classification = "Insufficient data";
  } else if (forced_high_risk) {
    classification = "High risk — pattern consistent with documented rug/wash setups";
  } else if (composite_score >= 0.8) {
    classification = "Lower relative risk — still verify manually before entry";
  } else if (composite_score >= 0.5) {
    classification = "Elevated risk — multiple unresolved flags";
  } else {
    classification = "High risk — pattern consistent with documented rug/wash setups";
  }

  const missingFields = [
    data.mint_authority_revoked == null && "mint_authority_revoked",
    data.freeze_authority_revoked == null && "freeze_authority_revoked",
    data.lp_locked_or_burned == null && "lp_locked_or_burned",
    data.top10_holder_pct == null && "top10_holder_pct",
    data.connected_cluster_pct == null && "connected_cluster_pct",
    data.unique_buyer_count == null && "unique_buyer_count",
    data.volume_24h_usd == null && "volume_24h_usd",
    data.pct_volume_from_top10_wallets == null && "pct_volume_from_top10_wallets",
    data.dev_previous_tokens_count == null && "dev_previous_tokens_count",
    data.dev_previous_rug_flags == null && "dev_previous_rug_flags",
    data.is_name_copycat == null && "is_name_copycat",
    (!data.social_mention_velocity_trend || data.social_mention_velocity_trend === "unknown") && "social_mention_velocity_trend",
    data.promoted_by_kol == null && "promoted_by_kol",
  ].filter(Boolean);

  const result = { token, sub_scores, composite_score, classification, forced_high_risk, missing_data_fields: missingFields, data };
  result.summary = buildSummary(result);
  delete result.data;
  return result;
}

// ── UI ────────────────────────────────────────────────────

const API = "./api/memescreener";
let settings = { discordWebhook: "" };
let currentResult = null;

function bool(val) { if (val === "true") return true; if (val === "false") return false; return null; }
function num(val) { const n = parseFloat(val); return isNaN(n) ? null : n; }

function collectData() {
  const g = id => document.getElementById(id)?.value ?? "";
  return {
    age_minutes:                    num(g("f-age")),
    mint_authority_revoked:         bool(g("f-mint")),
    freeze_authority_revoked:       bool(g("f-freeze")),
    lp_locked_or_burned:            bool(g("f-lp")),
    top10_holder_pct:               num(g("f-top10")),
    connected_cluster_pct:          num(g("f-cluster")),
    unique_buyer_count:             num(g("f-buyers")),
    volume_24h_usd:                 num(g("f-vol")),
    pct_volume_from_top10_wallets:  num(g("f-vol10")),
    dev_previous_tokens_count:      num(g("f-devtokens")),
    dev_previous_rug_flags:         num(g("f-devrugs")),
    is_name_copycat:                bool(g("f-copycat")),
    social_mention_velocity_trend:  g("f-social") || "unknown",
    promoted_by_kol:                bool(g("f-kol")),
    kol_known_large_holder:         bool(g("f-kolholder")),
    kol_post_age_minutes:           num(g("f-kolage")),
    kol_on_disclosed_paid_promo_list: bool(g("f-kolpromo")),
  };
}

function scoreLabel(v) {
  if (v === null) return `<span class="ms-score-null">—</span>`;
  if (v === 0) return `<span class="ms-score-red">🔴 Red</span>`;
  if (v === 1) return `<span class="ms-score-yellow">🟡 Caution</span>`;
  return `<span class="ms-score-green">🟢 Clean</span>`;
}

function classColor(cls) {
  if (cls.startsWith("Lower")) return "ms-cls-low";
  if (cls.startsWith("Elevated")) return "ms-cls-mid";
  if (cls.startsWith("Insufficient")) return "ms-cls-unknown";
  return "ms-cls-high";
}

function renderResult(r) {
  const pct = r.composite_score != null ? Math.round(r.composite_score * 100) : null;
  const scoreHTML = pct != null
    ? `<div class="ms-score-ring ${classColor(r.classification)}">
        <svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" stroke-opacity="0.1" stroke-width="3.2"/>
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" stroke-width="3.2"
          stroke-dasharray="${pct} ${100 - pct}" stroke-dashoffset="25" stroke-linecap="round"/>
        </svg>
        <span class="ms-score-pct">${pct}%</span>
      </div>`
    : `<div class="ms-score-ring ms-cls-unknown"><span class="ms-score-pct">?</span></div>`;

  const subScores = Object.entries(r.sub_scores).map(([k, v]) => `
    <div class="ms-sub-row">
      <span class="ms-sub-label">${k.replace(/_/g," ")}</span>
      ${scoreLabel(v)}
    </div>`).join("");

  const missing = r.missing_data_fields?.length
    ? `<div class="ms-missing"><span class="ms-missing-label">Missing fields</span> ${r.missing_data_fields.join(", ")}</div>`
    : "";

  document.getElementById("ms-result-panel").innerHTML = `
    <div class="ms-result-header">
      ${scoreHTML}
      <div class="ms-result-meta">
        <div class="ms-token-name">${r.token || "—"}</div>
        <div class="ms-classification ${classColor(r.classification)}">${r.classification}</div>
        ${r.forced_high_risk ? `<div class="ms-forced-tag">⚠️ Force-classified</div>` : ""}
      </div>
    </div>
    <div class="ms-sub-scores">${subScores}</div>
    <div class="ms-summary">${r.summary}</div>
    ${missing}
    <div class="ms-actions">
      <button id="ms-alert-btn" class="btn btn-primary" type="button">Send to Discord</button>
      <span id="ms-alert-status" class="ms-alert-status"></span>
    </div>`;

  document.getElementById("ms-alert-btn")?.addEventListener("click", sendAlert);
}

function runScore() {
  const token = (document.getElementById("f-token")?.value || "").trim() || "Unknown";
  const data = collectData();
  currentResult = computeResult(token, data);
  renderResult(currentResult);
}

async function sendAlert() {
  if (!currentResult) return;
  const btn = document.getElementById("ms-alert-btn");
  const status = document.getElementById("ms-alert-status");
  btn.disabled = true;
  status.textContent = "Sending…";
  try {
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "alert", result: currentResult }),
    }).then(x => x.json());
    status.textContent = r.ok ? "✓ Sent" : `✗ ${r.error}`;
    status.className = `ms-alert-status ${r.ok ? "ok" : "err"}`;
  } catch {
    status.textContent = "✗ Failed";
    status.className = "ms-alert-status err";
  } finally {
    btn.disabled = false;
  }
}

async function loadSettings() {
  try {
    const d = await fetch(API).then(r => r.json());
    settings = d.settings || settings;
    const el = document.getElementById("ms-s-webhook");
    if (el) el.value = settings.discordWebhook || "";
  } catch { /* non-fatal */ }
}

function bindSettings() {
  document.getElementById("ms-settings-btn")?.addEventListener("click", () => {
    document.getElementById("ms-settings-overlay").hidden = false;
  });
  document.getElementById("ms-settings-close")?.addEventListener("click", () => {
    document.getElementById("ms-settings-overlay").hidden = true;
  });
  document.getElementById("ms-settings-cancel")?.addEventListener("click", () => {
    document.getElementById("ms-settings-overlay").hidden = true;
  });
  document.getElementById("ms-settings-overlay")?.addEventListener("click", e => {
    if (e.target === e.currentTarget) document.getElementById("ms-settings-overlay").hidden = true;
  });
  document.getElementById("ms-settings-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const webhook = document.getElementById("ms-s-webhook").value.trim();
    const d = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "settings", discordWebhook: webhook }),
    }).then(r => r.json());
    if (d.ok) {
      settings = d.settings;
      document.getElementById("ms-settings-overlay").hidden = true;
    }
  });
}

function bindForm() {
  document.querySelectorAll(".ms-field").forEach(el => {
    el.addEventListener("change", runScore);
    el.addEventListener("input", runScore);
  });
  document.getElementById("ms-screen-btn")?.addEventListener("click", runScore);
  // KOL field visibility
  document.getElementById("f-kol")?.addEventListener("change", () => {
    const show = document.getElementById("f-kol").value === "true";
    document.getElementById("ms-kol-extra").hidden = !show;
    runScore();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindForm();
  bindSettings();
  loadSettings();
  runScore();
});
