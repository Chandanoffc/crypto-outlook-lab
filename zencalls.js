"use strict";
/* ZenCalls frontend — manually curated conviction trade calls */

const API = "/api/zencalls";
let state = { calls: [], settings: { discordWebhook: "", notifyOnNew: true } };
let currentFilter = "open";
let priceSubs = {};           // symbol → { price, pricedAt }
let priceInterval = null;

// ── Utility ───────────────────────────────────────────────

function fmtPrice(v) {
  if (v == null || isNaN(v)) return "—";
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (v >= 1)    return v.toFixed(4);
  if (v >= 0.01) return v.toFixed(5);
  return v.toPrecision(4);
}

function fmtPct(v) {
  if (v == null || isNaN(v)) return "";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function fmtDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function pct(from, to) {
  if (!from || !to) return null;
  return ((to - from) / from) * 100;
}

// ── API ───────────────────────────────────────────────────

async function apiFetch(body) {
  const r = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function loadCalls() {
  try {
    const data = await fetch(API).then(r => r.json());
    if (data.ok) {
      state.calls = data.calls || [];
      state.settings = data.settings || state.settings;
      renderAll();
      schedulePriceRefresh();
    }
  } catch (e) {
    setStatus("neutral", "Failed to load calls");
  }
}

// ── Live prices (Binance ticker) ──────────────────────────

function openSymbols() {
  return [...new Set(
    state.calls
      .filter(c => c.status === "open")
      .map(c => c.symbol.toUpperCase())
  )];
}

async function fetchPrices(symbols) {
  if (!symbols.length) return;
  try {
    const results = await Promise.allSettled(
      symbols.map(sym =>
        fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${sym}`)
          .then(r => r.json())
          .then(d => ({ sym, price: parseFloat(d.price) }))
      )
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.price > 0) {
        priceSubs[r.value.sym] = { price: r.value.price, pricedAt: Date.now() };
      }
    }
    updatePriceStrips();
  } catch (_) {}
}

function schedulePriceRefresh() {
  clearInterval(priceInterval);
  const syms = openSymbols();
  if (!syms.length) return;
  fetchPrices(syms);
  priceInterval = setInterval(() => fetchPrices(openSymbols()), 10_000);
}

function updatePriceStrips() {
  document.querySelectorAll(".zc-card[data-id]").forEach(card => {
    const id = card.dataset.id;
    const call = state.calls.find(c => c.id === id);
    if (!call || call.status !== "open") return;
    const info = priceSubs[call.symbol.toUpperCase()];
    if (!info) return;
    const priceEl = card.querySelector(".zc-live-price");
    const pnlEl   = card.querySelector(".zc-pnl");
    if (priceEl) priceEl.textContent = fmtPrice(info.price);
    if (pnlEl) {
      const p = pct(call.entry, info.price);
      if (p != null) {
        pnlEl.textContent = fmtPct(call.side === "short" ? -p : p);
        pnlEl.className = "zc-pnl " + (p === 0 ? "neu" : (call.side === "long" ? (p > 0 ? "pos" : "neg") : (p < 0 ? "pos" : "neg")));
      }
    }
  });
}

// ── Render ────────────────────────────────────────────────

function setStatus(tone, msg) {
  const dot = document.getElementById("zc-status-dot");
  const msgEl = document.getElementById("zc-status-msg");
  if (dot) {
    dot.className = "status-dot " + (tone === "up" ? "status-dot--up" : tone === "down" ? "status-dot--down" : "status-dot--neutral");
  }
  if (msgEl) msgEl.textContent = msg;
}

function renderStats(calls) {
  const open   = calls.filter(c => c.status === "open").length;
  const tp     = calls.filter(c => c.status === "tp1" || c.status === "tp2").length;
  const sl     = calls.filter(c => c.status === "sl").length;
  const closed = tp + sl;
  const wr     = closed ? Math.round((tp / closed) * 100) : null;

  document.getElementById("stat-open").textContent  = open;
  document.getElementById("stat-tp").textContent    = tp;
  document.getElementById("stat-sl").textContent    = sl;
  document.getElementById("stat-wr").textContent    = wr != null ? wr + "%" : "—";
  document.getElementById("stat-total").textContent = calls.length;

  const openCount = document.getElementById("zc-open-count");
  if (openCount) openCount.textContent = open + " open" + (open === 1 ? " call" : " calls");

  setStatus(open > 0 ? "up" : "neutral", open > 0 ? `${open} active call${open > 1 ? "s" : ""}` : "No open calls");
}

function renderCallCard(call) {
  const isLong = call.side === "long";
  const sideClass = isLong ? "is-long" : "is-short";
  const closedClass = call.status !== "open" ? " is-closed" : "";
  const tp2Class = call.status === "tp2" ? " is-tp2-hit" : "";

  const priceInfo = priceSubs[call.symbol.toUpperCase()];
  const livePrice = priceInfo ? fmtPrice(priceInfo.price) : "—";
  const rawPnl    = priceInfo ? pct(call.entry, priceInfo.price) : null;
  const adjPnl    = rawPnl != null ? (isLong ? rawPnl : -rawPnl) : null;
  const pnlClass  = adjPnl == null ? "neu" : adjPnl > 0 ? "pos" : adjPnl < 0 ? "neg" : "neu";

  const statusLabel = { open: "Open", tp1: "TP1 Hit", tp2: "TP2 Hit", sl: "SL Hit", closed: "Closed" }[call.status] || call.status;

  function lvl(label, val, cls = "") {
    if (val == null) return "";
    const hitClass = (label === "TP1" && call.status === "tp2") || (label === "SL" && call.status === "sl") ? " hit" : "";
    return `<div class="zc-level ${cls}${hitClass}">
      <span class="zc-level-label">${label}</span>
      <span class="zc-level-val">${fmtPrice(val)}</span>
    </div>`;
  }

  const actionButtons = call.status === "open"
    ? `<button class="zc-action-btn tp" data-action="tp1" data-id="${call.id}">TP1</button>
       ${call.tp2 != null ? `<button class="zc-action-btn tp" data-action="tp2" data-id="${call.id}">TP2</button>` : ""}
       <button class="zc-action-btn sl" data-action="sl" data-id="${call.id}">SL</button>
       <button class="zc-action-btn del" data-action="delete" data-id="${call.id}">✕</button>`
    : `<button class="zc-action-btn del" data-action="delete" data-id="${call.id}">Remove</button>`;

  return `
    <div class="zc-card ${sideClass}${closedClass}${tp2Class}" data-id="${call.id}">
      <div class="zc-card-header">
        <div class="zc-card-left">
          <span class="zc-card-symbol">${call.symbol}</span>
          <div class="zc-card-meta">
            <span class="zc-side-badge ${isLong ? "long" : "short"}">${call.side.toUpperCase()}</span>
            <span class="zc-tf-chip">${call.timeframe}</span>
          </div>
        </div>
        <span class="zc-status-badge ${call.status}">${statusLabel}</span>
      </div>

      ${call.pattern ? `<div class="zc-pattern">${call.pattern}</div>` : ""}

      <div class="zc-levels">
        ${lvl("Entry", call.entry)}
        ${lvl("TP1", call.tp1, "tp")}
        ${lvl("TP2", call.tp2, "tp")}
        ${lvl("SL", call.sl, "sl")}
      </div>

      ${call.status === "open" ? `
      <div class="zc-price-strip">
        <span class="zc-live-price">${livePrice}</span>
        <span class="zc-pnl ${pnlClass}">${adjPnl != null ? fmtPct(adjPnl) : ""}</span>
      </div>` : ""}

      ${call.note ? `<div class="zc-note">${call.note}</div>` : ""}

      <div class="zc-card-footer">
        <span class="zc-card-date">${fmtDate(call.createdAt)}</span>
        <div class="zc-card-actions">${actionButtons}</div>
      </div>
    </div>
  `;
}

function filteredCalls() {
  if (currentFilter === "open")   return state.calls.filter(c => c.status === "open");
  if (currentFilter === "closed") return state.calls.filter(c => c.status !== "open");
  return state.calls;
}

function renderGrid() {
  const grid = document.getElementById("zc-calls-grid");
  if (!grid) return;
  const calls = filteredCalls();
  if (!calls.length) {
    const label = currentFilter === "open" ? "No open calls" : currentFilter === "closed" ? "No closed calls" : "No calls yet";
    grid.innerHTML = `<div class="zc-empty-state">
      <div class="zc-empty-icon">📋</div>
      <p class="zc-empty-title">${label}</p>
      <p class="zc-empty-sub">${currentFilter === "open" ? "Add the first conviction call using the button above." : "Closed calls will appear here."}</p>
    </div>`;
    return;
  }
  grid.innerHTML = calls.map(renderCallCard).join("");
  bindCardActions();
}

function renderAll() {
  renderStats(state.calls);
  renderGrid();
}

// ── Card action bindings ──────────────────────────────────

function bindCardActions() {
  document.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (!id) return;

      if (action === "delete") {
        if (!confirm("Remove this call?")) return;
        const data = await apiFetch({ action: "delete", id });
        if (data.ok) { state.calls = data.calls; renderAll(); }
        return;
      }

      // tp1, tp2, sl → update status
      const data = await apiFetch({ action: "update", id, status: action });
      if (data.ok) { state.calls = data.calls; renderAll(); schedulePriceRefresh(); }
    });
  });
}

// ── Filter tabs ───────────────────────────────────────────

function bindFilterTabs() {
  document.querySelectorAll(".zc-filter-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      currentFilter = tab.dataset.filter;
      document.querySelectorAll(".zc-filter-tab").forEach(t => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      renderGrid();
    });
  });
}

// ── Add Call Modal ────────────────────────────────────────

function openAddModal(callToEdit) {
  const overlay = document.getElementById("zc-modal-overlay");
  const title   = document.getElementById("zc-modal-title");
  const submit  = document.getElementById("zc-form-submit");
  const errEl   = document.getElementById("zc-form-error");

  document.getElementById("zc-edit-id").value = callToEdit ? callToEdit.id : "";
  document.getElementById("zc-f-symbol").value  = callToEdit?.symbol  || "";
  document.getElementById("zc-f-side").value    = callToEdit?.side    || "long";
  document.getElementById("zc-f-tf").value      = callToEdit?.timeframe || "4h";
  document.getElementById("zc-f-pattern").value = callToEdit?.pattern || "";
  document.getElementById("zc-f-entry").value   = callToEdit?.entry   ?? "";
  document.getElementById("zc-f-tp1").value     = callToEdit?.tp1     ?? "";
  document.getElementById("zc-f-tp2").value     = callToEdit?.tp2     ?? "";
  document.getElementById("zc-f-sl").value      = callToEdit?.sl      ?? "";
  document.getElementById("zc-f-note").value    = callToEdit?.note    || "";

  title.textContent  = callToEdit ? "Edit Call" : "New Call";
  submit.textContent = callToEdit ? "Save Changes" : "Add Call";
  if (errEl) errEl.hidden = true;

  overlay.hidden = false;
  document.getElementById("zc-f-symbol").focus();
}

function closeAddModal() {
  document.getElementById("zc-modal-overlay").hidden = true;
}

function bindAddModal() {
  document.getElementById("zc-add-btn")?.addEventListener("click", () => openAddModal(null));
  document.getElementById("zc-modal-close")?.addEventListener("click", closeAddModal);
  document.getElementById("zc-modal-cancel")?.addEventListener("click", closeAddModal);
  document.getElementById("zc-modal-overlay")?.addEventListener("click", e => {
    if (e.target === e.currentTarget) closeAddModal();
  });

  document.getElementById("zc-call-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const errEl  = document.getElementById("zc-form-error");
    const submit = document.getElementById("zc-form-submit");

    const editId  = document.getElementById("zc-edit-id").value;
    const symbol  = document.getElementById("zc-f-symbol").value.trim().toUpperCase();
    const side    = document.getElementById("zc-f-side").value;
    const tf      = document.getElementById("zc-f-tf").value;
    const pattern = document.getElementById("zc-f-pattern").value.trim();
    const entry   = parseFloat(document.getElementById("zc-f-entry").value) || null;
    const tp1     = parseFloat(document.getElementById("zc-f-tp1").value)   || null;
    const tp2     = parseFloat(document.getElementById("zc-f-tp2").value)   || null;
    const sl      = parseFloat(document.getElementById("zc-f-sl").value)    || null;
    const note    = document.getElementById("zc-f-note").value.trim();

    if (!symbol) { showErr(errEl, "Symbol is required"); return; }
    if (!entry)  { showErr(errEl, "Entry price is required"); return; }

    submit.disabled = true;
    submit.textContent = "Saving…";

    try {
      const body = editId
        ? { action: "update", id: editId, note }
        : { action: "add", symbol, side, timeframe: tf, pattern, entry, tp1, tp2, sl, note };

      const data = await apiFetch(body);
      if (!data.ok) { showErr(errEl, data.error || "Failed to save"); return; }

      state.calls = data.calls;
      closeAddModal();
      renderAll();
      schedulePriceRefresh();
    } finally {
      submit.disabled = false;
      submit.textContent = editId ? "Save Changes" : "Add Call";
    }
  });
}

function showErr(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

// ── Settings Modal ────────────────────────────────────────

function openSettingsModal() {
  document.getElementById("zc-s-webhook").value = state.settings.discordWebhook || "";
  document.getElementById("zc-s-notify").checked = state.settings.notifyOnNew !== false;
  document.getElementById("zc-settings-overlay").hidden = false;
}

function closeSettingsModal() {
  document.getElementById("zc-settings-overlay").hidden = true;
}

function bindSettings() {
  document.getElementById("zc-settings-btn")?.addEventListener("click", openSettingsModal);
  document.getElementById("zc-settings-close")?.addEventListener("click", closeSettingsModal);
  document.getElementById("zc-settings-cancel")?.addEventListener("click", closeSettingsModal);
  document.getElementById("zc-settings-overlay")?.addEventListener("click", e => {
    if (e.target === e.currentTarget) closeSettingsModal();
  });
  document.getElementById("zc-settings-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const webhook    = document.getElementById("zc-s-webhook").value.trim();
    const notifyOnNew = document.getElementById("zc-s-notify").checked;
    const data = await apiFetch({ action: "settings", discordWebhook: webhook, notifyOnNew });
    if (data.ok) {
      state.settings = data.settings;
      closeSettingsModal();
    }
  });
}

// ── Strategy Scanner Signals ──────────────────────────────

const STRAT_API = "./api/zencalls?view=strategy";
let stratPrices = {};

function fmt(n) {
  if (n == null) return "—";
  return n >= 1000 ? n.toFixed(2) : n >= 1 ? n.toFixed(4) : n.toPrecision(5);
}

function timeAgo(ts) {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

function renderStratCard(sig) {
  const livePrice = stratPrices[sig.symbol] || null;
  const pnl = (livePrice && sig.entry)
    ? ((livePrice - sig.entry) / sig.entry * 100).toFixed(2)
    : null;
  const pnlStr = pnl != null
    ? `<span style="color:${parseFloat(pnl)>=0?'var(--long)':'var(--short)'}">${pnl >= 0 ? '+' : ''}${pnl}%</span>`
    : "";

  return `
  <div class="zc-strat-card">
    <div class="zc-strat-card-top">
      <span class="zc-strat-symbol">${sig.symbol}</span>
      <span class="zc-strat-rr">R:R 1:${sig.rr ?? "—"}</span>
    </div>
    <div class="zc-strat-pattern">${sig.pattern}</div>
    <div class="zc-strat-levels">
      <div class="zc-strat-level">
        <span class="label">Entry</span>
        <span class="val">${fmt(sig.entry)}</span>
      </div>
      <div class="zc-strat-level is-tp">
        <span class="label">TP1</span>
        <span class="val">${fmt(sig.tp1)}</span>
      </div>
      <div class="zc-strat-level is-tp">
        <span class="label">TP2</span>
        <span class="val">${fmt(sig.tp2)}</span>
      </div>
      <div class="zc-strat-level is-sl">
        <span class="label">SL</span>
        <span class="val">${fmt(sig.sl)}</span>
      </div>
    </div>
    <div class="zc-strat-footer">
      <span>${timeAgo(sig.detectedAt)}</span>
      <span class="zc-strat-live-price">${livePrice ? fmt(livePrice) : ""}${pnlStr ? ' · ' + pnlStr : ''}</span>
    </div>
  </div>`;
}

async function loadStratSignals() {
  try {
    const data = await fetch(STRAT_API).then(r => r.json());
    if (!data.ok) return;
    const signals = data.signals || [];
    const grid = document.getElementById("zc-strat-grid");
    const scanEl = document.getElementById("zc-strat-last-scan");
    if (scanEl) scanEl.textContent = `Last scan: ${timeAgo(data.lastScan)}`;
    if (!signals.length) {
      grid.innerHTML = `<div class="zc-empty-state">
        <div class="zc-empty-icon">🔍</div>
        <p class="zc-empty-title">No signals yet</p>
        <p class="zc-empty-sub">The strategy scanner fires when a setup matches. Check back after the next cron cycle.</p>
      </div>`;
      return;
    }
    // Fetch live prices for all strategy signal symbols
    const syms = [...new Set(signals.map(s => s.symbol))];
    try {
      const tickers = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price`).then(r => r.json());
      for (const t of tickers) stratPrices[t.symbol] = parseFloat(t.price);
    } catch { /* non-fatal */ }
    grid.innerHTML = signals.map(renderStratCard).join("");
  } catch { /* non-fatal */ }
}

// ── Paper Trade Dashboard ─────────────────────────────────

const PT_API = "./api/zencalls?view=papertrades";

function ptTimeAgo(ms) {
  if (!ms) return "—";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmtPt(v, prec = 2) {
  if (v == null) return "—";
  if (v >= 1000) return v.toFixed(prec);
  if (v >= 1)    return v.toFixed(Math.max(prec, 4));
  return v.toPrecision(4);
}

function renderPtCard(t, markPrice) {
  const isLong   = t.side === "long";
  const dir      = isLong ? "long" : "short";
  const isClosed = t.status !== "open";

  // Card class + outcome badge (mirrors EMAPerps exactly)
  let cardClass = `paper-pos-card paper-pos-card--${dir}`;
  let reasonHtml = "";
  if (isClosed) {
    if      (t.status === "tp2_hit") cardClass = "paper-pos-card paper-pos-card--win";
    else if (t.status === "tp1_hit") cardClass = "paper-pos-card paper-pos-card--win";
    else if (t.status === "sl_hit")  cardClass = "paper-pos-card paper-pos-card--loss";
    else                             cardClass = "paper-pos-card paper-pos-card--expired";
    const reasonMap = { tp2_hit: "TP2", tp1_hit: "TP1", sl_hit: "SL", expired: "EXP" };
    const reasonCls = { tp2_hit: "tp2", tp1_hit: "tp1", sl_hit: "sl", expired: "exp" };
    reasonHtml = `<span class="paper-pos-reason paper-pos-reason--${reasonCls[t.status] || "exp"}">${reasonMap[t.status] || "CLOSED"}</span>`;
  }

  // P&L
  let pnlStr = "—", pnlClass = "paper-pos-pnl--zero";
  if (isClosed && t.pnl_pct != null) {
    pnlClass = t.pnl_pct > 0 ? "paper-pos-pnl--pos" : t.pnl_pct < 0 ? "paper-pos-pnl--neg" : "paper-pos-pnl--zero";
    pnlStr   = `${t.pnl_pct >= 0 ? "+" : ""}${t.pnl_pct.toFixed(2)}%`;
  } else if (!isClosed && markPrice && t.entry) {
    const diff = isLong ? markPrice - t.entry : t.entry - markPrice;
    const pct  = (diff / t.entry) * 100;
    pnlClass   = pct > 0 ? "paper-pos-pnl--pos" : pct < 0 ? "paper-pos-pnl--neg" : "paper-pos-pnl--zero";
    pnlStr     = `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
  }

  // Live levels block (open positions only) — identical to EMAPerps
  let liveLevelsHtml = "";
  if (!isClosed && markPrice && t.entry) {
    const movePct = ((isLong ? markPrice - t.entry : t.entry - markPrice) / t.entry * 100).toFixed(1);
    const toTP1 = t.tp1 ? ((isLong ? t.tp1 - markPrice : markPrice - t.tp1) / markPrice * 100) : null;
    const toTP2 = t.tp2 ? ((isLong ? t.tp2 - markPrice : markPrice - t.tp2) / markPrice * 100) : null;
    const toSL  = t.sl  ? ((isLong ? markPrice - t.sl  : t.sl - markPrice)  / markPrice * 100) : null;
    const fDist = (v, label, cls) => v != null
      ? `<span class="pos-level-row ${cls}"><span class="pos-level-tag">${label}</span><span class="pos-level-dist">${v > 0 ? v.toFixed(1) + "% away" : "REACHED"}</span><span class="pos-level-price">${fmtPt(label === "TP1" ? t.tp1 : label === "TP2" ? t.tp2 : t.sl)}</span></span>`
      : "";
    liveLevelsHtml = `
      <div class="pos-live-row">
        <span class="pos-live-now">Now <strong>${fmtPt(markPrice)}</strong></span>
        <span class="pos-live-move ${Number(movePct) >= 0 ? "tone-up" : "tone-down"}">${Number(movePct) >= 0 ? "+" : ""}${movePct}% from entry</span>
      </div>
      <div class="pos-levels-strip">
        ${fDist(toSL,  "SL",  "pos-level--sl")}
        ${fDist(toTP1, "TP1", "pos-level--tp1")}
        ${fDist(toTP2, "TP2", "pos-level--tp2")}
      </div>`;
  }

  return `
    <div class="${cardClass}">
      <div class="paper-pos-head">
        <div class="paper-pos-ident">
          <span class="paper-pos-symbol">${t.symbol}</span>
          <span class="paper-pos-side paper-pos-side--${dir}">${isLong ? "LONG" : "SHORT"}</span>
          ${!isClosed ? `<span class="paper-pos-status">LIVE</span>` : ""}
        </div>
        <div class="paper-pos-right">
          <span class="paper-pos-pnl ${pnlClass}">${pnlStr}</span>
          ${reasonHtml}
        </div>
      </div>
      ${liveLevelsHtml}
      <div class="paper-pos-meta">
        <span>Entry ${fmtPt(t.entry)} · ${t.pattern || "—"}</span>
        <span>${isClosed ? ptTimeAgo(t.closedAt) : "Opened " + ptTimeAgo(t.detectedAt)}</span>
      </div>
      <div class="paper-pos-meta">
        <span>TP1 ${fmtPt(t.tp1)} · TP2 ${fmtPt(t.tp2)} · SL ${fmtPt(t.sl)}${t.rr_target != null ? " · R:R 1:" + t.rr_target : ""}</span>
        ${isClosed && t.exit_price ? `<span>Exit ${fmtPt(t.exit_price)}</span>` : ""}
      </div>
    </div>`;
}

function renderPtStats(stats) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const setColored = (id, val, num) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = val;
    el.style.color = num > 0 ? "var(--long, #22c55e)" : num < 0 ? "var(--short, #ef4444)" : "";
  };
  set("pt-stat-wr",     stats.win_rate != null ? stats.win_rate + "%" : "—");
  set("pt-stat-open",   stats.open   ?? 0);
  set("pt-stat-closed", stats.closed ?? 0);
  setColored("pt-stat-totalpnl", stats.total_pnl != null ? (stats.total_pnl >= 0 ? "+" : "") + stats.total_pnl.toFixed(2) + "%" : "—", stats.total_pnl ?? 0);
  setColored("pt-stat-avgpnl",   stats.avg_pnl   != null ? (stats.avg_pnl   >= 0 ? "+" : "") + stats.avg_pnl.toFixed(2)   + "%" : "—", stats.avg_pnl   ?? 0);
  const wl = document.getElementById("pt-stat-wl");
  if (wl) wl.innerHTML = stats.wins != null
    ? `<span style="color:var(--long,#22c55e)">${stats.wins}W</span> / <span style="color:var(--short,#ef4444)">${stats.losses ?? 0}L</span>`
    : "—";
}

async function loadPaperTrades() {
  try {
    const data = await fetch(PT_API).then(r => r.json());
    if (!data.ok) return;
    const trades = data.trades || [];
    renderPtStats(data.stats || {});

    const open   = trades.filter(t => t.status === "open");
    const closed = trades.filter(t => t.status !== "open");

    // Fetch live Binance prices for open positions
    const markPrices = {};
    if (open.length) {
      try {
        const syms = new Set(open.map(t => t.symbol));
        const prices = await fetch("https://fapi.binance.com/fapi/v1/ticker/price").then(r => r.json());
        for (const p of prices) { if (syms.has(p.symbol)) markPrices[p.symbol] = parseFloat(p.price); }
      } catch { /* best-effort */ }
    }

    const openEl   = document.getElementById("zc-pt-open");
    const closedEl = document.getElementById("zc-pt-closed");

    openEl.innerHTML = open.length
      ? open.map(t => renderPtCard(t, markPrices[t.symbol] ?? null)).join("")
      : `<div class="paper-empty">No open positions.</div>`;

    closedEl.innerHTML = closed.length
      ? closed.slice(0, 50).map(t => renderPtCard(t, null)).join("")
      : `<div class="paper-empty">No closed trades yet.</div>`;
  } catch { /* non-fatal */ }
}

async function resetPaperTrades() {
  if (!confirm("Reset all ZenCalls paper trades? This clears every open and closed trade.")) return;
  try {
    const res = await fetch("./api/zencalls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "paper-reset" }) });
    const data = await res.json();
    if (data.ok) loadPaperTrades();
  } catch (err) { alert(`Reset failed: ${err.message}`); }
}

// ── Init ──────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  bindFilterTabs();
  bindAddModal();
  bindSettings();
  setStatus("neutral", "Loading…");
  loadCalls();
  loadStratSignals();
  loadPaperTrades();
  const resetBtn = document.getElementById("zc-pt-reset");
  if (resetBtn) resetBtn.addEventListener("click", resetPaperTrades);
  setInterval(loadStratSignals, 60_000);
  setInterval(loadPaperTrades, 60_000);
});
