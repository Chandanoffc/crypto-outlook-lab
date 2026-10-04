# Soloris Signals — Daily Agent Log

## 2026-10-04

**ClaudePerps**: N/A — strategy was removed from the platform on 2026-09-25 (commit `17844d2`, "remove ClaudePerps — stop all signals, delete engine and UI"). `.claude/daily-agent.md` still documents it as live; that doc is stale.

**EMAPerps**: ⚠️ Could not fetch live state — see blocker below.

**BTC**: ⚠️ Could not fetch — see blocker below.

---

### ⚠️ Blocker: network egress policy blocked the health check and performance analysis

This session's container network policy denied outbound access to both required hosts:
- `soloris-signals.vercel.app` (platform state API — needed for Task 1 health check and Task 3 performance analysis)
- `fapi.binance.com` (BTC ticker — needed for Task 1 macro check)

Every `curl`/`WebFetch` attempt returned `EGRESS_BLOCKED` / `connect_rejected` from the agent proxy. `WebSearch` worked fine (different path), so Task 2 research was completed, but Tasks 1 and 3 could not run, and no live-data-justified strategy/quality changes were made as a result — per the agent instructions ("every change must be justified by data," "if in doubt, don't make it").

**Action needed**: widen this environment's network allowlist (Custom network access → add `soloris-signals.vercel.app` and `fapi.binance.com` under Allowed domains) so tomorrow's run can complete the health check and performance analysis.

---

### Research findings (Task 2)

- **EMA pullback win rates**: public backtests put disciplined EMA-pullback systems at 45–60% WR with >1.8:1 avg R:R; trend-following filters (EMA/ADX) consistently outperform mean-reversion (RSI) in crypto over 2020–2025. Our ADX<18-skip / ADX≥25-bonus and 4H trend hard-block already encode this.
- **MACD/RSI confluence**: best-performing checklists in current research combine MACD-above-zero (trend) + RSI holding 60–80 through a pullback (momentum regime, not an oversold bounce) + ROC>2% (acceleration) — reported ~61% WR / 1.8 R:R on 6-month BTC 4H samples. Our current RSI gate (38–56 long / 44–62 short) is directionally selective but samples a lower momentum band than this research suggests; worth a future backtest comparing against a "RSI holding above 55 through the pullback" variant — **not changed today**, no fresh trade data to validate against.
- **ADX usage**: research confirms the "wait for ADX > 25 before trusting a MACD/trend signal" heuristic — matches our existing `adx4h >= 25` quality bonus and `<18` ranging-skip for P/Q signals.
- **Funding rate edge**: extreme funding (strongly positive or negative) tends to precede mean-reversion/squeezes because it marks a crowded, over-leveraged side — but there's no universal threshold, and it works best combined with OI/liquidation context, not alone. `fundingRate` is already captured per-signal and shown in the UI; not reliable enough alone to justify a new quality bonus without backtesting against our own trade data.
- **Market structure**: October 2026 altcoin attention is on QNT, SUI, AAVE, SAND, PUMP (volume/whale-activity driven); broader market showing overbought RSI readings (BTC/SOL in the mid-60s) after a strong ETF-inflow week — a reminder the BTC-macro and ADX filters matter more than usual right now.

### Changes implemented

Two surgical bug fixes found during code review (no trading-logic/quality changes — no fresh performance data was available to justify any):

1. **`api/daily-digest.js`** — fixed a crash. The 2026-09-25 ClaudePerps removal left `generateSuggestions()`/`buildDiscordMessage()` being called with `{}` placeholders for the deleted `cpSig`/`cpPaper`/`cpTiers` params, but the function bodies still unconditionally read properties like `cpSig.pending.length` → `TypeError: Cannot read properties of undefined`. This endpoint is hit daily at 09:00 UTC by the `daily-digest.yml` GitHub Action (`curl --fail`), so the daily Discord performance digest has been silently failing (HTTP 500) every day since the ClaudePerps removal. Finished the cleanup properly: dropped all `cp*` params/sections instead of papering over them with empty objects. Verified with a standalone simulation (empty-state and populated-state) — both now run clean.
2. **`emaperps.js`** (reasoning panel) — fixed a stale display label. The "Trade Levels" card hardcoded `TP1 (+2.5R)` / `TP2 (+5R)`, left over from the old ATR-based P/Q signal sizing. The engine switched to fixed-% SL/TP uniformly across all signal types in a later commit (SL 1.5%, TP1 3.0%, TP2 6.0% = 2R/4R per the runtime's own comments), so the UI was showing the wrong R-multiple to anyone sizing a trade off it. Now computed live from the signal's own entry/SL/TP so it can't drift out of sync again.

**Considered but deferred** (no data to justify, or cosmetic-only):
- Re-testing the RSI gate against the wider 60–80 "momentum regime" band research surfaced — needs a backtest against real closed-trade data first.
- Adding funding-rate extremes as a quality bonus — plausible per research, but unproven against this platform's own trades; risk of adding unvalidated complexity.
- `emaperps.html` panel still titled "24H Strategy Comparison" even though only one strategy remains — cosmetic only, deferred.
- `api/notify.js` Discord banner fallback label still defaults to `"CLAUDEPERPS"` if `event.strategy` is ever missing — in practice EMAPerps always sets `strategy: "EMA PERPS"`, so this is dead-path cosmetic only.

### Watch tomorrow

- **Priority**: confirm network access to `soloris-signals.vercel.app` and `fapi.binance.com` has been restored, then run the full Task 1 health check + Task 3 performance analysis that was skipped today.
- Once trade data is available, backtest the RSI-band change and funding-rate-bonus idea from today's research before implementing either.
- Verify the `daily-digest.yml` GitHub Action run succeeds now (previously failing silently every day since 2026-09-25).
