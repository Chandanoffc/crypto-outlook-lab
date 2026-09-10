"use strict";

const API = "./api/memescreener";
let lastScanData = null; // { result, rawData }
let settings = { discordWebhook: "" };

// ── Scoring (mirrors backend, runs on overrides) ──────────

function bool(v) { if (v === "true") return true; if (v === "false") return false; return null; }
function num(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }

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
  if (d.promoted_by_kol == null || !d.promoted_by_kol) return 2;
  if (d.kol_known_large_holder || d.kol_on_disclosed_paid_promo_list) return 0;
  return 1;
}

function computeScore(token, ca, data) {
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
  const composite_score = nonNull.length ? nonNull.reduce((s, v) => s + v, 0) / (2 * nonNull.length) : null;
  const forced_high_risk = sub_scores.distribution_safety === 0 || sub_scores.dev_history === 0;
  let classification;
  const nullCount = total - nonNull.length;
  if (nullCount > total / 2) classification = "Insufficient data — fill in missing fields";
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
    social_mention_velocity_trend: (!data.social_mention_velocity_trend || data.social_mention_velocity_trend === "unknown") ? null : 1,
    promoted_by_kol: data.promoted_by_kol,
  }).filter(([, v]) => v == null).map(([k]) => k);

  return { token, ca, sub_scores, composite_score, classification, forced_high_risk, missing_data_fields: missing };
}

// ── Render ────────────────────────────────────────────────

function clsCss(cls) {
  if (cls.startsWith("Lower")) return "ms-cls-low";
  if (cls.startsWith("Elevated")) return "ms-cls-mid";
  if (cls.startsWith("Insufficient")) return "ms-cls-unknown";
  return "ms-cls-high";
}

function scoreLabel(v) {
  if (v === null) return `<span class="ms-score-null">—</span>`;
  if (v === 0)    return `<span class="ms-score-red">🔴 Red flag</span>`;
  if (v === 1)    return `<span class="ms-score-yellow">🟡 Caution</span>`;
  return              `<span class="ms-score-green">🟢 Clean</span>`;
}

function fmtUsd(n) {
  if (n == null) return "—";
  if (n >= 1e9) return `$${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n/1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n/1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function renderMarketStrip(market) {
  const el = document.getElementById("ms-market-strip");
  if (!market) { el.hidden = true; return; }
  const items = [
    ["Price",      market.price_usd     ? `$${parseFloat(market.price_usd).toExponential(3)}` : "—"],
    ["Vol 24h",    fmtUsd(market.volume_24h_usd)],
    ["Liquidity",  fmtUsd(market.liquidity_usd)],
    ["FDV",        fmtUsd(market.fdv)],
    ["Age",        market.age_minutes != null ? `${market.age_minutes}m` : "—"],
    ["DEX",        market.dex_name || "—"],
  ];
  el.innerHTML = items.map(([l, v]) => `
    <div class="ms-mkt-item">
      <span class="ms-mkt-label">${l}</span>
      <span class="ms-mkt-val">${v}</span>
    </div>`).join("");
  if (market.pair_url) {
    el.innerHTML += `<a href="${market.pair_url}" target="_blank" rel="noopener" class="ms-dex-link">View on DexScreener ↗</a>`;
  }
  el.hidden = false;
}

function renderResult(result) {
  const pct = result.composite_score != null ? Math.round(result.composite_score * 100) : null;
  const css = clsCss(result.classification);

  // Ring
  const ringWrap = document.getElementById("ms-ring-wrap");
  if (pct != null) {
    ringWrap.innerHTML = `
      <div class="ms-score-ring ${css}">
        <svg viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" stroke-opacity="0.12" stroke-width="3.2"/>
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" stroke-width="3.2"
            stroke-dasharray="${pct} ${100-pct}" stroke-dashoffset="25" stroke-linecap="round"/>
        </svg>
        <span class="ms-score-pct">${pct}%</span>
      </div>`;
  } else {
    ringWrap.innerHTML = `<div class="ms-score-ring ms-cls-unknown"><span class="ms-score-pct">?</span></div>`;
  }

  document.getElementById("ms-token-name").textContent = result.token;
  const caEl = document.getElementById("ms-ca-display");
  caEl.textContent = result.ca ? result.ca.slice(0, 16) + "…" : "";
  caEl.title = result.ca || "";

  const clsEl = document.getElementById("ms-classification");
  clsEl.textContent = result.classification;
  clsEl.className = `ms-classification ${css}`;

  document.getElementById("ms-forced-tag").hidden = !result.forced_high_risk;

  // Sub scores
  document.getElementById("ms-sub-scores").innerHTML = Object.entries(result.sub_scores)
    .map(([k, v]) => `
      <div class="ms-sub-row">
        <span class="ms-sub-label">${k.replace(/_/g, " ")}</span>
        ${scoreLabel(v)}
      </div>`).join("");

  // Summary
  const lines = [];
  if (result.forced_high_risk) {
    const t = [];
    if (result.sub_scores.distribution_safety === 0) t.push("extreme holder concentration");
    if (result.sub_scores.dev_history === 0) t.push("confirmed dev rug history");
    lines.push(`Force-classified High Risk due to ${t.join(" and ")}.`);
  } else {
    lines.push(`${result.token} scores ${pct ?? "?"}% — ${result.classification}.`);
  }
  const reds = Object.entries(result.sub_scores).filter(([,v])=>v===0).map(([k])=>k.replace(/_/g," "));
  if (reds.length) lines.push(`Red flags: ${reds.join(", ")}.`);
  lines.push("This tool screens documented failure patterns only — it cannot detect novel scams or predict price.");
  document.getElementById("ms-summary").textContent = lines.join(" ");

  // Missing fields
  const missingEl = document.getElementById("ms-missing");
  if (result.missing_data_fields?.length) {
    missingEl.innerHTML = `<span class="ms-missing-label">⚠️ Missing</span> ${result.missing_data_fields.join(", ")} — add below to improve score`;
    missingEl.hidden = false;
  } else {
    missingEl.hidden = true;
  }

  document.getElementById("ms-alert-status").textContent = "";
  document.getElementById("ms-result-wrap").hidden = false;
}

// ── Scan ──────────────────────────────────────────────────

async function scan() {
  const ca = document.getElementById("ms-ca-input").value.trim();
  if (!ca) return;

  const btn = document.getElementById("ms-scan-btn");
  const status = document.getElementById("ms-scan-status");
  btn.disabled = true;
  btn.textContent = "Scanning…";
  status.textContent = "Fetching on-chain data via Helius + DexScreener…";
  status.hidden = false;
  status.className = "ms-scan-status";
  document.getElementById("ms-result-wrap").hidden = true;

  try {
    const d = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "scan", ca }),
    }).then(r => r.json());

    if (!d.ok) throw new Error(d.error || "Scan failed");

    lastScanData = d.result;
    renderMarketStrip(d.result.market);
    renderResult(d.result);
    status.hidden = true;
    // Reset override fields
    ["ov-cluster","ov-vol10","ov-devtokens","ov-devrugs"].forEach(id => { const el = document.getElementById(id); if(el) el.value = ""; });
    ["ov-copycat","ov-social","ov-kol","ov-kolholder","ov-kolpromo"].forEach(id => { const el = document.getElementById(id); if(el) el.value = ""; });
    document.getElementById("ov-kol-extra").hidden = true;
  } catch (e) {
    status.textContent = `✗ ${e.message}`;
    status.className = "ms-scan-status err";
  } finally {
    btn.disabled = false;
    btn.textContent = "Screen";
  }
}

function rescore() {
  if (!lastScanData) return;
  const base = { ...(lastScanData._rawData || lastScanData) };
  // Apply overrides
  const cluster = num(document.getElementById("ov-cluster")?.value);
  const vol10   = num(document.getElementById("ov-vol10")?.value);
  const devt    = num(document.getElementById("ov-devtokens")?.value);
  const devr    = num(document.getElementById("ov-devrugs")?.value);
  const copycat = bool(document.getElementById("ov-copycat")?.value);
  const social  = document.getElementById("ov-social")?.value || "unknown";
  const kol     = bool(document.getElementById("ov-kol")?.value);
  const kolh    = bool(document.getElementById("ov-kolholder")?.value);
  const kolp    = bool(document.getElementById("ov-kolpromo")?.value);

  // Merge into last scan data
  const merged = { ...lastScanData };
  // We need the original fetched data fields
  const data = {
    mint_authority_revoked:   lastScanData.sub_scores?.contract_safety === 2 ? true : lastScanData.sub_scores?.contract_safety === 0 ? false : null,
    freeze_authority_revoked: lastScanData.sub_scores?.contract_safety === 2 ? true : lastScanData.sub_scores?.contract_safety === 0 ? false : null,
    lp_locked_or_burned:      lastScanData.sub_scores?.contract_safety === 2 ? true : null,
    top10_holder_pct:         null,
    connected_cluster_pct:    cluster,
    unique_buyer_count:       null,
    volume_24h_usd:           lastScanData.market?.volume_24h_usd || null,
    pct_volume_from_top10_wallets: vol10,
    dev_previous_tokens_count: devt,
    dev_previous_rug_flags:   devr,
    is_name_copycat:          copycat,
    social_mention_velocity_trend: social,
    promoted_by_kol:          kol,
    kol_known_large_holder:   kolh,
    kol_on_disclosed_paid_promo_list: kolp,
  };

  const rescored = computeScore(lastScanData.token, lastScanData.ca, data);
  rescored.market = lastScanData.market;
  lastScanData = rescored;
  renderResult(rescored);
}

async function sendAlert() {
  if (!lastScanData) return;
  const btn = document.getElementById("ms-alert-btn");
  const status = document.getElementById("ms-alert-status");
  btn.disabled = true;
  status.textContent = "Sending…";
  try {
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "alert", result: lastScanData }),
    }).then(x => x.json());
    status.textContent = r.ok ? "✓ Sent to Discord" : `✗ ${r.error}`;
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

function bindAll() {
  document.getElementById("ms-scan-btn")?.addEventListener("click", scan);
  document.getElementById("ms-ca-input")?.addEventListener("keydown", e => { if (e.key === "Enter") scan(); });
  document.getElementById("ms-alert-btn")?.addEventListener("click", sendAlert);
  document.getElementById("ms-rescore-btn")?.addEventListener("click", rescore);

  document.getElementById("ov-kol")?.addEventListener("change", () => {
    document.getElementById("ov-kol-extra").hidden = document.getElementById("ov-kol").value !== "true";
  });

  // Settings modal
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
    if (d.ok) { settings = d.settings; document.getElementById("ms-settings-overlay").hidden = true; }
  });
}

// ── Auto-scan loader ──────────────────────────────────────

function fmtUsd(v) {
  if (v == null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}
function fmtPrice(v) {
  if (v == null) return "—";
  const n = parseFloat(v);
  return isNaN(n) ? "—" : `$${n.toExponential(3)}`;
}

function fmtTimeAgo(ts) {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)  return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function renderAutoCard(token) {
  const score = token.composite_score;
  const scorePct = score != null ? Math.round(score * 100) : null;
  const scoreClass = scorePct == null ? "" : scorePct >= 70 ? "green" : scorePct >= 50 ? "amber" : "red";
  const source = token.source === "pumpfun" ? "🎰 Pump.fun" : "📡 DexScreener";
  const top10  = token.top10_holder_pct != null ? `${token.top10_holder_pct.toFixed(1)}%` : "—";
  const p5m    = token.price_change_5m  != null
    ? `${token.price_change_5m > 0 ? "+" : ""}${token.price_change_5m.toFixed(1)}%` : "—";
  const p5mClass = token.price_change_5m > 0 ? "green" : token.price_change_5m < 0 ? "red" : "";
  const vol5mRatio = token.vol_5m_to_1h_pct != null ? `${token.vol_5m_to_1h_pct.toFixed(0)}%` : "—";
  const bundleStr  = token.likely_bundled ? "⚠️ Bundled" : "✅ Clean";
  const bundleCls  = token.likely_bundled ? "red" : "green";
  const narrativeTags = (token.narrative || []).map(n =>
    `<span class="ms-auto-badge" style="background:rgba(167,139,250,0.15)">#${n}</span>`).join(" ");

  // When we detected this token
  const detectedAgo = fmtTimeAgo(token.detectedAt);

  // Price change since detection
  const dp = token.detected_price ? parseFloat(token.detected_price) : null;
  const cp = token.current_price  ? parseFloat(token.current_price)  : null;
  let pctChangeStr = null, pctChangeClass = "";
  if (dp && cp && dp > 0) {
    const pct = ((cp - dp) / dp) * 100;
    const sign = pct >= 0 ? "+" : "";
    pctChangeStr  = `${sign}${pct.toFixed(1)}%`;
    pctChangeClass = pct >= 0 ? "up" : "down";
  }

  // Milestone display
  const milestones = token.milestones_hit || [];
  const milestoneBadges = milestones.map(m => `<span class="ms-milestone-badge">${m}</span>`).join("");

  // Current multiplier
  const mult = token.current_multiple;
  const multStr = mult != null ? `${mult}×` : "—";
  const multClass = mult == null ? "" : mult >= 3 ? "green" : mult >= 1.5 ? "amber" : "";

  const card = document.createElement("div");
  card.className = "ms-auto-card";
  card.innerHTML = `
    <div class="ms-auto-card-header">
      <span class="ms-auto-sym">${token.symbol || token.name || "?"}</span>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end">
        ${scorePct != null ? `<span class="ms-auto-score ${scoreClass}">${scorePct}%</span>` : ""}
        <span class="ms-auto-badge">${source}</span>
      </div>
    </div>
    <div class="ms-auto-detected-row">
      <span class="ms-auto-detected-time">Detected ${detectedAgo}</span>
      ${pctChangeStr ? `<span class="ms-pct-change ${pctChangeClass}">${pctChangeStr} since call</span>` : ""}
    </div>
    ${milestones.length ? `<div class="ms-milestones-row">${milestoneBadges}</div>` : ""}
    ${narrativeTags ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:2px">${narrativeTags}</div>` : ""}
    <div class="ms-auto-stats">
      <div class="ms-auto-stat"><span class="ms-auto-stat-label">MC at Detection</span><span class="ms-auto-stat-val">${fmtUsd(token.detected_mc)}</span></div>
      <div class="ms-auto-stat"><span class="ms-auto-stat-label">Current ×</span><span class="ms-auto-stat-val ms-auto-score ${multClass}" style="background:none;padding:0">${multStr}</span></div>
      <div class="ms-auto-stat"><span class="ms-auto-stat-label">5m Price</span><span class="ms-auto-stat-val ms-score-${p5mClass}">${p5m}</span></div>
      <div class="ms-auto-stat"><span class="ms-auto-stat-label">Vol 5m</span><span class="ms-auto-stat-val">${fmtUsd(token.vol_5m_usd)}</span></div>
      <div class="ms-auto-stat"><span class="ms-auto-stat-label">5m of 1h</span><span class="ms-auto-stat-val">${vol5mRatio}</span></div>
      <div class="ms-auto-stat"><span class="ms-auto-stat-label">Liquidity</span><span class="ms-auto-stat-val">${fmtUsd(token.liquidity_usd)}</span></div>
      <div class="ms-auto-stat"><span class="ms-auto-stat-label">Top 10%</span><span class="ms-auto-stat-val">${top10}</span></div>
      <div class="ms-auto-stat"><span class="ms-auto-stat-label">Bundle</span><span class="ms-auto-stat-val ms-score-${bundleCls}">${bundleStr}</span></div>
    </div>
    <div class="ms-auto-mint">${token.mint}</div>
  `;

  // Click to copy CA + open DexScreener
  card.addEventListener("click", () => {
    navigator.clipboard?.writeText(token.mint).catch(() => {});
    document.getElementById("ms-ca-input").value = token.mint;
    if (token.pair_url) window.open(token.pair_url, "_blank");
  });

  return card;
}

async function loadAutoScans() {
  const grid   = document.getElementById("ms-auto-grid");
  const status = document.getElementById("ms-auto-status");
  if (!grid) return;
  try {
    const d = await fetch(`${API}?view=autoscans`).then(r => r.json());
    const tokens = d.tokens || [];
    const lastScan = d.lastScan;
    if (lastScan) {
      const mins = Math.floor((Date.now() - lastScan) / 60000);
      status.textContent = `Last scan: ${mins < 1 ? "just now" : mins + "m ago"} · ${tokens.length} detected`;
    } else {
      status.textContent = "No scan yet — runs on next cron tick";
    }
    grid.innerHTML = "";
    if (!tokens.length) {
      grid.innerHTML = `<div class="ms-auto-empty">No tokens detected yet. Check back after the next hourly scan, or trigger <code>/api/cron-scan</code> manually.</div>`;
      return;
    }
    for (const t of tokens) grid.appendChild(renderAutoCard(t));
  } catch (e) {
    status.textContent = "Failed to load";
    grid.innerHTML = `<div class="ms-auto-empty">Error: ${e.message}</div>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  bindAll();
  loadSettings();
  loadAutoScans();
  document.getElementById("ms-auto-refresh")?.addEventListener("click", loadAutoScans);
});
