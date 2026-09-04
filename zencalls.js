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

// ── Init ──────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  bindFilterTabs();
  bindAddModal();
  bindSettings();
  setStatus("neutral", "Loading…");
  loadCalls();
});
