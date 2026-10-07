# Soloris Signals — Daily Agent Log

## 2026-10-07

**EMAPerps**: ⚠️ Could not fetch live state — same network blocker as the last three days, unresolved. See below.

**BTC**: ⚠️ Could not fetch — see blocker below.

---

### ⚠️ Blocker: network egress policy blocked the health check and performance analysis (day 4)

Same denial as 2026-10-04 through 2026-10-06, re-confirmed today via direct `curl`:

```
curl: (56) CONNECT tunnel failed, response 403
host: soloris-signals.vercel.app:443
host: fapi.binance.com:443
```

Tasks 1 and 3 could not run — no live state, no BTC ticker, no closed-trade data to validate any quality-score or strategy change against. `WebFetch` to ordinary research articles (kucoin.com, luxalgo.com) was also `EGRESS_BLOCKED` today, same as yesterday's broader block — this is not a one-off, the environment's allowlist is tighter than just the platform/Binance hosts. `WebSearch` still works, so Task 2 ran on search-result snippets only, no full-article reads.

The GitHub Action status check (`gh run list --workflow=daily-digest.yml`) also failed today with a separate error: `HTTP 403: GitHub access to this repository is not enabled for this session` — the `gh` CLI needs the repo attached via `add_repo`, which plain `git clone`/`push` doesn't grant. Not able to confirm the digest workflow's run history today.

**Action needed (repeating ask, now a fourth day)**: in this environment's settings, set Network access to a broader level, or to Custom with `soloris-signals.vercel.app` and `fapi.binance.com` added under Allowed domains. Separately, attaching this repo via `add_repo` with API access would let future runs check GitHub Actions status directly instead of relying on `git`-only access.

---

### Research findings (Task 2)

- **Quantified volume-confirmation rule surfaced today**: one search snippet described a concrete entry filter — current volume ≥1.5× the 20-period volume average, combined with RSI ≥70/≤30 extremes and a minimum candle body (0.15% of price) to avoid doji/low-momentum entries. This is more specific than the vague "pullback volume < impulse volume" idea noted on prior days, but `WebFetch` being blocked meant the source (a LuxAlgo indicator listing) couldn't be read in full, and — importantly — this platform already tried and removed a volume-based quality bonus (see `lib/emaperps-runtime.js`, "Volume bonus removed: volume spikes at S/R are just as often breakdowns as bounces — they added noise and were strongly correlated with Q90 losses"). Any reintroduction needs to be validated against this platform's own closed trades before being added back, not assumed from an unrelated indicator's marketing page.
- **MACD/RSI confluence**: KuCoin's 2026 guide (snippet only) reiterates combining MACD crossovers with RSI strength and 4H/daily timeframes — directionally consistent with what's already implemented (BTC 4H macro filter + RSI gate + ADX). No new actionable rule.
- **ADX > 25 as trend confirmation**: continues to be the most consistently-repeated heuristic across four days of research. Matches the existing `adx4h >= 25` bonus / `<18` ranging-skip exactly — no change needed.
- **Market structure**: HYPE, TRX, ZEC, XLM are the current standout performers; Aster (ASTER) and Avantis (AVNT) also posted strong gains on perp-DEX volume (~$1.1T September volume, +$340B in the first three days of October). Delphi Digital is on record saying the "synchronized altcoin growth" era is over and capital is concentrating in fewer, proven names — a reminder that the $200M volume floor and BTC-macro filter matter more in a narrower market, not less. Nothing here changes the existing volume floor or symbol universe.
- **Funding rate edge**: same conclusion as the last four days — persistently high positive or deeply negative funding precedes mean-reversion/squeezes, but there's no universal threshold and it needs OI/liquidation context to be reliable alone. `fundingRate` is already captured per-signal; still withholding a standalone quality bonus pending real trade data.

### Changes implemented

No trading-logic or quality-score changes — four days running with no closed-trade data to validate any against. Found one real dead-code issue during code review instead:

1. **`lib/emaperps-runtime.js`** (`detectSignal`, around the fixed-%-SL/TP block) — removed a 5-line comment describing a "guard" against fixed TP1 landing on the wrong side of a structural S/R level, followed by `const slDistance = Math.abs(price - sl);`. The guard logic itself was never implemented (there's no code after the comment that reads `slDistance` or blocks on it anywhere in the file — confirmed via a repo-wide search), and the variable is computed and discarded on every signal. Likely a leftover from an earlier version of the signal-filtering logic that was removed when SL/TP switched to the current fixed-% scheme. No behavior change — this code was already inert — but it was actively misleading (reads like a real filter is in effect when none is).

**Considered but deferred** (unchanged reasoning — still no trade data to validate against):
- Volume-confirmation filter (today's more specific ≥1.5×-average-volume version, or the earlier "pullback volume < impulse volume" version) — this platform already tested and removed a volume bonus for being noisy/correlated with losses; reintroducing any version needs backtest evidence, not research-article claims.
- Funding-rate-extreme quality bonus.
- RSI gate widening to a wider "momentum regime" band.

### Watch tomorrow

- **Priority, now repeated four times**: get network access to `soloris-signals.vercel.app` and `fapi.binance.com` restored. Until that happens, Tasks 1 and 3 cannot run and no data-driven strategy change can be made in good conscience.
- The broader WebFetch block (research articles beyond the platform/Binance hosts) has now persisted two days in a row — worth flagging to the user as likely a deliberate/tightened policy rather than transient.
- `gh` CLI has no API access to this repo in this session (`add_repo` needed) — can't check GitHub Actions run history until that's attached, separate from the network-egress issue.
- Once access is restored and trade data is available: backtest the volume-confirmation filter (now with a concrete ≥1.5× threshold to test), funding-rate bonus, and RSI-band widening ideas before implementing any of them.

---

## 2026-10-06

**EMAPerps**: ⚠️ Could not fetch live state — same network blocker as the last two days, unresolved. See below.

**BTC**: ⚠️ Could not fetch — see blocker below.

---

### ⚠️ Blocker: network egress policy blocked the health check and performance analysis (day 3)

Same denial as 2026-10-04 and 2026-10-05, confirmed via the agent-proxy status endpoint:

```
gateway answered 403 to CONNECT (policy denial or upstream failure)
host: soloris-signals.vercel.app:443
host: fapi.binance.com:443
```

Tasks 1 and 3 could not run — no live state, no BTC ticker, no closed-trade data to validate any quality-score or strategy change against. This time the block was broader than before: `WebFetch` to ordinary research articles (trader-dale.com, stratbase.ai, kucoin.com) was also `EGRESS_BLOCKED`, where on 2026-10-04/05 WebFetch had worked fine for research even while the platform/Binance hosts were blocked. `WebSearch` still worked, so Task 2 ran on search-result snippets only — no full-article reads this time.

**Action needed (repeating ask, now a third day)**: in this environment's settings, set Network access to a broader level, or to Custom with `soloris-signals.vercel.app` and `fapi.binance.com` added under Allowed domains, so a future run can complete the health check and performance analysis instead of logging this same blocker again.

---

### Research findings (Task 2)

- EMA-pullback + VWAP trend filter: one backtest source reported the plain EMA20 pullback strategy sits at 48.5% WR on its own, improving to 60% WR when a VWAP-above/below trend filter is added as a gate. This is the most concrete, quantified filter idea surfaced in three days of research — but WebFetch being blocked today meant the exact rule (price-vs-VWAP condition, timeframe, asset class) couldn't be read in full, and it still needs validation against this platform's own closed trades before being implemented. Flagging for backtesting once data access is restored.
- RSI+MACD confluence: search snippets repeated the same combination this platform already implements in spirit (MACD-direction + RSI-not-overbought timing) — one source claims a 77% WR pairing RSI+MACD, another an EMA/MACD momentum variant at 62% WR / 1.95 PF. These numbers are far above what's realistic for a public strategy and read as marketing copy rather than rigorous backtests; treating with skepticism, not actioning.
- ADX > 25 as a trend-confirmation gate before trusting MACD/RSI signals continues to be the most consistently-repeated, credible heuristic across all three days of research — matches the existing `adx4h >= 25` bonus and `<18` ranging-skip exactly. No change needed, already implemented.
- Market structure: QNT (+300% after a tokenized-deposit-settlement selection), SUI, AAVE, and HYPE are the names with real catalysts this week; XRP/DOGE still showing the fastest OI growth. Nothing here changes the existing $200M volume floor or symbol universe — all already within scope of the scanned perp universe.
- Funding rate edge: same conclusion as prior days — extreme funding (crowded positioning) precedes mean-reversion/squeezes, but there's no universal threshold and it needs OI/liquidation context to be reliable. `fundingRate` is already captured per-signal; still not confident enough to add as a standalone quality bonus without backtesting against real trade data.

### Changes implemented

No trading-logic or quality-score changes — three days running with no closed-trade data to validate any against (same constraint as yesterday and the day before). Found and fixed a real stale-value bug during code review instead:

1. **The breakeven-trigger threshold display was wrong on two different panels and one backtest comment — all three said "25%", but the engine has run at 10% since an earlier commit.** Git history shows `PAPER_BE_TRIGGER_PCT` was lowered from 25 to 10 in a prior commit, but three downstream references were never updated:
   - `emaperps.js` (open-position card) — the 🛡️ breakeven badge literally rendered `+25% SL→Breakeven` to users watching a live position, when the real trigger that had just fired was 10%. Fixed to `+10%`.
   - `lib/emaperps-runtime.js` — the comment directly above the `PAPER_BE_TRIGGER_PCT` check still said "crosses +25%". Fixed to say +10% and reference the constant name directly so it can't drift silently again.
   - `lib/backtest-runtime.js` — the `runtime.PAPER_BE_TRIGGER_PCT || 25` fallback default (dead in practice since the real export is always a truthy 10, but wrong if that ever changed) was corrected to `|| 10`, and a companion comment claiming "~25%/5x = 5% underlying move trigger" was fixed to the correct "~10%/5x = 2%". Also found and removed `beTriggerMovePct`, a variable computed from that same constant but never actually used anywhere in the file — dead code left over from an earlier version of the simulation logic.
2. **Dead references to the deleted ClaudePerps engine, cleaned up again.** Two more comments in `lib/emaperps-runtime.js` ("identical implementation to claudeperps-runtime — see comments there", "same alignment filter as claudeperps") and two in `lib/backtest-runtime.js` pointed at a `claudeperps-runtime.js` file that was deleted on 2026-09-25 and no longer exists — the "see comments there" reference was actively misleading. Removed the dead pointers and rewrote the backtest-harness comment about dual `candles`/`candles1h` keys to describe it as forward-compatibility for a future second engine rather than referring to one that's gone.

**Considered but deferred** (unchanged reasoning — still no trade data to validate against):
- EMA-pullback volume-confirmation filter (pullback volume < impulse volume) as a new quality bonus.
- VWAP-as-trend-filter idea from today's research — concrete and quantified (48%→60% WR in one source) but couldn't be read in full today (WebFetch blocked) and unvalidated against this platform's own trades regardless.
- Funding-rate-extreme quality bonus.
- RSI gate widening to a wider "momentum regime" band.

### Watch tomorrow

- **Priority, now repeated three times**: get network access to `soloris-signals.vercel.app` and `fapi.binance.com` restored. Until that happens, Tasks 1 and 3 cannot run and no data-driven strategy change can be made in good conscience.
- Today's broader WebFetch block (research articles, not just the platform/Binance hosts) is new — worth checking tomorrow whether it's transient or whether the egress allowlist tightened further.
- Once access is restored and trade data is available: backtest the VWAP-trend-filter idea (48%→60% WR claim) alongside the volume-confirmation filter, funding-rate bonus, and RSI-band widening ideas already queued from prior days — before implementing any of them.

---

## 2026-10-05

**EMAPerps**: ⚠️ Could not fetch live state — same network blocker as yesterday, unresolved. See below.

**BTC**: ⚠️ Could not fetch — same blocker.

---

### ⚠️ Blocker persists (day 2): network egress policy still blocks the health check and performance analysis

Identical to yesterday — `soloris-signals.vercel.app` and `fapi.binance.com` are still denied by this container's network egress policy (`EGRESS_BLOCKED` via both `curl` and `WebFetch`; confirmed via `/__agentproxy/status`: `gateway answered 403 to CONNECT`). `WebSearch` still works fine (separate path), so Task 2 ran, but Tasks 1 and 3 could not, again, and no live-data-justified quality/strategy changes were made for the same reason as yesterday.

**Action needed (repeating ask)**: in this environment's settings, set Network access to a broader level, or to Custom with `soloris-signals.vercel.app` and `fapi.binance.com` added under Allowed domains, so tomorrow's run can actually complete the health check and performance analysis instead of logging this same blocker a third time.

---

### Research findings (Task 2)

- Reconfirmed from fresh sources: ADX > 25 as a trend-confirmation gate before trusting MACD/RSI signals is a widely-used heuristic (MACD = "engine", RSI/ADX/volume = "navigation") — matches the existing `adx4h >= 25` bonus and `<18` skip, no change needed.
- EMA-pullback volume-confirmation research again surfaced the same validated idea noted yesterday: comparing pullback-phase volume to impulse-phase volume (pullback should show *lower* volume than the preceding impulse leg) helps distinguish a genuine pullback from an early reversal. Still not implemented — would need a backtest against this platform's own closed trades to size the bonus correctly, and that data is exactly what's blocked right now.
- Funding-rate-extreme reversal signal: a concrete 2026 case study (BTC funding flipping from -0.005% in April to +8–15% annualized by August, followed by a $1.74B short-liquidation squeeze on Aug 20) reinforces that crowded/extreme funding precedes violent mean reversion — but confirms the same caveat as before: no universal threshold, works best combined with OI/liquidation context, and unvalidated against our own trades.
- Market structure: XRP/DOGE posted the fastest week-over-week OI growth; AAVE/SAND/PUMP are the names with real on-chain signal (DeFi activity, whale flows, social attention) behind the move, not just price. Nothing here changes the existing $200M volume floor or symbol universe.

### Changes implemented

No trading-logic or quality-score changes — still no fresh closed-trade data to justify any (same constraint as yesterday). Two more dead-reference cleanups found during code review, left over from the 2026-09-25 ClaudePerps removal that yesterday's run flagged as deferred:

1. **`emaperps.html`** — the performance panel's `panel-label` still read "24H Strategy Comparison" from when the page compared two engines. Now reads "24H Performance" to match reality (one engine, not a comparison).
2. **`api/notify.js`** (4 call sites) — the Discord alert-banner footer's strategy-label fallback defaulted to `"CLAUDEPERPS"` if `event.strategy` were ever missing. Dead-path in practice (EMAPerps always sets `strategy: "EMA PERPS"`), but a wrong fallback for a deleted engine is worth fixing cheaply. Changed the fallback (and its sanitizer default) to `"EMA PERPS"` at all four sites.
3. **`.claude/daily-agent.md`** — these instructions still described ClaudePerps as a live second engine (architecture section, Task 1 curl commands, Task 3, Task 6 log template). Updated to describe the platform as it actually exists today (EMAPerps only), and added an explicit instruction for future runs to log and flag — not silently skip — an `EGRESS_BLOCKED` network denial instead of guessing at numbers.

**Considered but deferred** (unchanged from yesterday — still no trade data to validate against):
- EMA-pullback volume-confirmation filter (pullback volume < impulse volume) as a new quality bonus.
- Funding-rate-extreme quality bonus.
- RSI gate widening to the "momentum regime" 60–80 band research keeps surfacing.

### Watch tomorrow

- **Priority, now repeated twice**: get network access to `soloris-signals.vercel.app` and `fapi.binance.com` restored. Until that happens, Tasks 1 and 3 cannot run and no data-driven strategy change can be made in good conscience.
- Once access is restored and trade data is available: backtest the volume-confirmation filter, funding-rate bonus, and RSI-band widening ideas before implementing any of them.
- Confirm the `daily-digest.yml` GitHub Action is succeeding again after yesterday's crash fix (it was failing silently every day since 2026-09-25).

---

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
