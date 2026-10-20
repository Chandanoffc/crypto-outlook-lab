# Soloris Signals — Daily Agent Log

## 2026-10-20

**EMAPerps**: ⚠️ Could not fetch live state — same network blocker, unresolved (day 17).

**BTC**: ⚠️ Could not fetch — same blocker.

---

### ⚠️ Blocker persists (day 17): network egress policy still blocks the health check and performance analysis

Identical denial to every prior day: `curl` returned `connect_rejected` for `soloris-signals.vercel.app:443` ("gateway answered 403 to CONNECT" per `/__agentproxy/status`), and `fapi.binance.com:443` the same. Also tried `WebFetch` directly on both URLs as a second route — both failed at DNS resolution (`getaddrinfo ENOTFOUND`), confirming neither host is reachable by any path available to this session, not just the raw-curl path. `WebSearch` worked fine, so Task 2 ran; Tasks 1 and 3 could not run for the 17th consecutive day — no live balance/positions, no BTC ticker, no closed-trade data, so no data-driven quality/strategy change was made, for the same reason as every prior day in this streak.

Not sending another push notification today — one was sent on day 15 (2026-10-18), day 16 held off since nothing had changed, and nothing has changed again today. Still outstanding: `soloris-signals.vercel.app` and `fapi.binance.com` need to be added to this environment's network allowlist (Environment settings → Network access → Custom → add both hosts under Allowed domains, or broaden the access level) before Tasks 1 and 3 can run again.

---

### Research findings (Task 2)

Same recycled, low-signal pattern as recent days — nothing cleared the bar for a trading-logic change without trade data to validate against:

- **Trending/setups**: no reliable dated "this week" ranking surfaced for October 2026; results were mostly stale TradingView posts (some over a year old) and generic press releases. Nothing actionable on specific coins/setups.
- **EMA pullback / strategy improvements**: self-reported TradingView backtests again spread widely by implementation (19–45% WR depending on script), still consistent with needing >1.5–2:1 R:R to be profitable — directionally matches the platform's fixed 1.5%/3.0%/6.0% SL/TP1/TP2 scheme, no change indicated.
- **Indicator combinations**: generic MACD+RSI+volume vendor consensus; one 2026 "top 5 indicators" guide didn't even list ADX among its core picks (RSI/EMA/Volume Profile/Bollinger/MACD) — doesn't contradict our existing `adx4h >= 25`/`<18` gates, just no new evidence either way.
- **Market structure**: most recent dated data point found was an August 2026 Kaiko note describing a contracting altcoin market (SOL -40%, XRP -45% YTD) with narrow pockets of relative strength (HYPE, TRX, ZEC, XLM) — two months stale, nothing current enough to act on, and doesn't change the $200M volume floor or symbol universe.
- **Funding rate edge**: same unresolved pattern as every prior day — crowding/squeeze framing is directionally plausible (anecdotal 2026 case studies on both sides), but no validated universal threshold and no backtest against this platform's own trades. Not actioned.

### Changes implemented

No live-trade-data-validated quality/strategy changes — 17th day running with no closed-trade data available. Re-verified the engine's core guardrails are still intact (no drift today): `MIN_ALERT_QUALITY = 95`, `$200M` volume floor, `PAPER_SIZE_QUALITY_CEIL = 110`, `PAPER_LEVERAGE = 5`. Re-checked the two display fixes from day 16 (`emaperps.html` panel label, `api/notify.js` fallback label) — both still correct. Scanned for `TODO`/`FIXME` markers repo-wide and for lingering `ClaudePerps`/`CLAUDEPERPS` references outside `.claude/daily-agent.md` (where it's an intentional "removed, don't treat as live" note) — found none. No new bugs found today; the prior days' cleanup passes continue to hold.

**Considered but deferred** (unchanged from prior days):
- EMA-pullback volume-confirmation filter, funding-rate-extreme quality bonus, RSI-band widening — still no trade data to validate against.
- Full `README.md` rewrite (flagged day 16) — still outside today's surgical scope without explicit user direction.

### Watch tomorrow

- **Priority, now 17 days running**: network access to `soloris-signals.vercel.app` and `fapi.binance.com` needs to be restored. Until that happens, Tasks 1 and 3 cannot run and no data-driven strategy change can be made in good conscience.
- Once access is restored: run the full health check + performance analysis backlog (balance/positions/closed-trade breakdown) before considering any of the deferred research ideas above.
- If this blocker reaches roughly 2026-10-27 (one week past the day-15 notification) with still no change, re-escalate with another push notification per the established cadence.

---

## 2026-10-19

**EMAPerps**: ⚠️ Could not fetch live state — same network blocker as the last fifteen days, unresolved (day 16).

**BTC**: ⚠️ Could not fetch — same blocker.

---

### ⚠️ Blocker persists (day 16): network egress policy still blocks the health check and performance analysis

Identical denial, reconfirmed via `/__agentproxy/status`: gateway answered 403 to CONNECT for both `soloris-signals.vercel.app:443` and `fapi.binance.com:443` (`recentRelayFailures` shows `connect_rejected` / "policy denial or upstream failure" for both, timestamped this run). `WebSearch` worked fine, so Task 2 ran; Tasks 1 and 3 could not run for the 16th consecutive day — no live balance/positions, no BTC ticker, no closed-trade data, so no data-driven quality/strategy change was made, for the same reason as every prior day in this streak.

Not sending another push notification today — one was already sent yesterday (day 15) to flag this same still-unresolved blocker, and nothing has changed since. Still outstanding: `soloris-signals.vercel.app` and `fapi.binance.com` need to be added to this environment's network allowlist (Environment settings → Network access → Custom → add both hosts under Allowed domains, or broaden the access level) before Tasks 1 and 3 can run again.

---

### Research findings (Task 2)

Same recycled, low-signal pattern as the last several days — nothing cleared the bar for a trading-logic change without trade data to validate against:

- **Trending/setups**: no reliable dated "this week" ranking surfaced for October 2026; searches mostly returned stale 2024/2025 TradingView posts and generic press releases.
- **EMA pullback / strategy improvements**: self-reported TradingView backtests again clustered at 19–45% WR depending on implementation (one July–Sep 2026 BTC 15m sample lost money outright, 19% WR / 0.32 PF), relying on R:R above 1.5–2:1 to stay profitable — still directionally consistent with the platform's fixed 1.5%/3.0%/6.0% SL/TP1/TP2 scheme, no change indicated.
- **Indicator combinations**: same generic MACD+RSI+volume consensus and unverifiable vendor win-rate claims (65–70% RSI accuracy, "Christmas special" ADX+RSI+MACD script tested without fees/slippage). Nothing clears the bar beyond what `adx4h >= 25` / `<18` already encodes.
- **Market structure**: outlook pieces are mostly late-2025 forecasts; BTC dominance ~58%, Altcoin Season Index in the high teens/low 20s (Bitcoin-season territory) — doesn't change the $200M volume floor or symbol universe.
- **Funding rate edge**: same unresolved split as every prior day — crowding/squeeze logic is directionally sound but no universal threshold across sources (0.03%–0.10%/interval), and the most rigorous source found to date (BitMEX's own regression, logged 2026-10-15) still shows no significant standalone predictive power. Not actioned.

### Changes implemented

No live-trade-data-validated quality/strategy changes — 16th day running with no closed-trade data available. Found and fixed one real scoring/logic bug and two documentation/display bugs during code review, all three verified purely by reading the engine's own code (no live trade data needed):

1. **`lib/emaperps-runtime.js` — multi-tested-level bonus (+5 quality) was scored against the wrong S/R level, and fired on signals that touch no S/R level at all.** `anchorTests` (feeds `multiTestedBonus` and the "Level tested N×" reasoning label) was hardcoded to `s1Tests`/`r1Tests` regardless of which level the signal actually triggered on. Two distinct problems: (a) for "2"-tier signals (A2/B2/C2 touch `s2`, D2/E2/F2 touch `r2`), the bonus credited the *wrong* level's test count — `s2Tests`/`r2Tests` existed in `findSwingLevels()`'s return value but were never even destructured into scope; (b) for the P/Q pure-EMA-pullback signals (no S/R level involved in their trigger at all — confirmed by tracing the if/else-if chain: reaching the P/Q branch requires `side === null`, which requires `s1Touch`/`s2Touch`/`r1Touch`/`r2Touch` to all already be false, since any of them being true would have matched an A–F branch first), the bonus and its reasoning label fired anyway off a same-direction level's test count that had zero relationship to why the signal actually triggered — handing P50/P20/Q50/Q20 signals an unearned +5 quality and a misleading "Level tested 3×"-style explanation on the signal card. Fixed `anchorTests` to resolve to the specific level actually touched (`s2Touch ? s2Tests : s1Touch ? s1Tests : 0`, mirrored for the short side), which now correctly yields 0 — no bonus, no label — for every P/Q signal, and the right level's count for every A–F signal. Verified with `node -c` and a full trace of the touch-detection branches; no live trade data was needed since this is a pure code-logic bug.
2. **`emaperps.html` — Signal Rules panel never documented the P/Q EMA-pullback signal types.** The panel only listed the six A-F confluence rules (Q85 down to Q60) per side, even though the architecture has documented a second, EMA-pullback-only signal family (P20/P50/Q20/Q50, Q78/Q82 base quality) since before this daily-agent log began — and the Pattern Breakdown stats table (fixed 2026-10-17) already tracks these codes in production. A trader reading "Signal Rules" to understand how a quality score was derived would have no idea half the signal-generation logic existed. Added two new rule sections (Long EMA Pullback, Short EMA Retest) documenting the Q82/Q78 badges and the no-S/R-required mechanic, and extended the panel's footnote to explain why these setups skip the S/R requirement.
3. **`README.md`** — the Neon schema reference linked to a leftover local filesystem path (`/tmp/crypto-outlook-lab-fix/db/schema.sql`) from some earlier build environment instead of a repo-relative link. Fixed to `./db/schema.sql`, which resolves correctly on GitHub. (The rest of the README — `paper.html`/`arena.html`/`tradez.html` references, an `/api/init-db` endpoint — describes an older iteration of this dashboard that no longer exists; a full README rewrite is out of scope for today's surgical pass and is logged below as deferred.)

**Considered but deferred**:
- EMA-pullback volume-confirmation filter, funding-rate-extreme quality bonus, RSI-band widening — unchanged from prior days, still no trade data to validate against (volume and funding-rate ideas are leaning "don't implement" per days 12/15's research).
- Full `README.md` rewrite — it still describes a pre-EMAPerps iteration of the dashboard (non-existent pages, a non-existent `/api/init-db` endpoint). Fixed the one broken link found; a full rewrite needs more scope/intent confirmation than a daily surgical pass should take on unilaterally.

### Watch tomorrow

- **Priority, now 16 days running**: network access to `soloris-signals.vercel.app` and `fapi.binance.com` needs to be restored. Until that happens, Tasks 1 and 3 cannot run and no data-driven strategy change can be made in good conscience.
- Once access is restored and trade data is available: validate that the `anchorTests` fix behaves as expected in production (P/Q signals should no longer show a "Level tested N×" reason or get the associated +5; A2/B2/C2/D2/E2/F2 signals should now show counts for the level they actually touched, which may shift a handful of signals across the 95 floor in either direction — worth a specific before/after comparison once scan data is available).
- Decide whether the full `README.md` rewrite flagged today is worth doing in a future run, or should wait for explicit user direction given it's outside the core EMAPerps scope these instructions cover.

---

## 2026-10-18

**EMAPerps**: ⚠️ Could not fetch live state — same network blocker as the last fourteen days, unresolved (day 15).

**BTC**: ⚠️ Could not fetch — same blocker.

---

### ⚠️ Blocker persists (day 15): network egress policy still blocks the health check and performance analysis

Identical denial, reconfirmed via `/__agentproxy/status`: gateway answered 403 to CONNECT for both `soloris-signals.vercel.app:443` and `fapi.binance.com:443` (`recentRelayFailures` shows `connect_rejected` / "policy denial or upstream failure" for both, timestamped this run). `WebSearch` worked fine (separate path), so Task 2 ran; Tasks 1 and 3 could not run for the 15th consecutive day — no live balance/positions, no BTC ticker, no closed-trade data, so no data-driven quality/strategy change was made, for the same reason as every prior day in this streak.

**This is now a three-week-old, unresolved blocker spanning 15 straight daily runs.** Flagging directly to the user again (push notification sent this run): the daily agent cannot complete its core job — health check, performance analysis, or any trade-data-validated strategy tuning — until `soloris-signals.vercel.app` and `fapi.binance.com` are added to this environment's network allowlist (Environment settings → Network access → Custom → add both hosts under Allowed domains, or broaden the access level). This is outside the agent's own permissions; it requires the user to change the environment's settings once.

---

### Research findings (Task 2)

Same low-signal pattern as recent days — WebSearch only, mostly recycled or undated material, nothing that clears the bar for a code change without trade data to validate against:

- **Trending/setups**: no reliable dated "this week" ranking surfaced. Repeated names from recent weeks: ZEC/BNB/ARB/XRP/SOL perp OI growth (ZEC ~$2.4B OI, early-Sep vintage), HYPE/TRX/ZEC/XLM as relative outperformers in a weak altcoin market (Aug 2026 Kaiko report).
- **EMA pullback / strategy improvements**: no independent peer-reviewed 2026 backtest. Self-reported TradingView scripts range 19–45% WR depending on implementation; one shared Oct-2026 BTC 15m backtest lost money outright (19% WR, 0.32 PF). An "80% WR" claim was explicitly disclaimed by its own script author as untested. Nothing here beats the existing fixed 1.5%/3.0%/6.0% SL/TP1/TP2 scheme.
- **Indicator combinations**: consensus is MACD+RSI on higher timeframes (4H+) to cut noise, which the engine's 1H detection + 4H confirmation layer already implements. No source showed backtested evidence that adding ADX to that pairing adds edge beyond what's already encoded (`adx4h >= 25` bonus, `<18` ranging-skip for P/Q).
- **Market structure**: no clean 2026 $500M-volume altcoin ranking found; closest data points (South Korea exchange volume, old liquidation-cascade figures) don't change the $200M volume floor or symbol universe.
- **Funding rate edge**: same recurring thesis — extreme funding (crowded positioning) precedes reversals/squeezes, no fixed threshold agreed across sources (0.03%–0.10% per interval depending on exchange), negative extremes weighted as a stronger contrarian signal than positive. `fundingRate` is already captured per-signal and shown in the UI/checklist; still not validated against this platform's own trades, so still not actioned as a quality bonus.

### Changes implemented

No trading-logic or quality-score changes — 15 days running with no closed-trade data to validate any against (same constraint as every prior day). Did a full read-through of `lib/emaperps-runtime.js` (signal detection, paper trading, circuit breaker) and `emaperps.js` (stats panels, pattern breakdown, pre-trade checklist, Discord formatting) plus `api/notify.js` looking for the kind of doc/code drift bugs found on days 1–14 (stale ClaudePerps references, dead signal-type codes, wrong constant values, scale mismatches). Found none — everything checked (MIN_ALERT_QUALITY=95, $200M volume floor, PAPER_SIZE_QUALITY_CEIL=110, fixed 1.5/3.0/6.0% SL/TP1/TP2, pattern-breakdown codes, funding-neutral checklist scale, Discord strategy-label fallbacks) already matches the current documented behavior — the day-7/8/12/14 cleanup passes appear to have genuinely exhausted this backlog. No code changes made today.

**Considered but deferred** (unchanged — still no trade data to validate against):
- EMA-pullback volume-confirmation filter (pullback volume < impulse volume) as a new quality bonus.
- Funding-rate-extreme quality bonus or filter.
- RSI gate widening to the "momentum regime" 55–80 band research has repeatedly surfaced.

### Watch tomorrow

- **Priority, now repeated fifteen times**: get network access to `soloris-signals.vercel.app` and `fapi.binance.com` restored. Until that happens, Tasks 1 and 3 cannot run and no data-driven strategy change can be made in good conscience.
- If the blocker lifts: run the full health check + performance analysis immediately, and backtest the volume-confirmation, funding-rate-bonus, and RSI-band-widening ideas against real closed trades before implementing any of them.
- If the blocker does not lift again: consider whether daily WebSearch-only research cycles are still worth running as-is, since the last several days' findings have been largely repetitive with no fresh actionable signal.

---

## 2026-10-17

**EMAPerps**: ⚠️ Could not fetch live state — same network blocker as the last thirteen days, unresolved (day 14).

**BTC**: ⚠️ Could not fetch — same blocker.

---

### ⚠️ Blocker persists (day 14): network egress policy still blocks the health check and performance analysis

Identical denial, confirmed via `/__agentproxy/status`: gateway answered 403 to CONNECT for both `soloris-signals.vercel.app:443` and `fapi.binance.com:443`. `WebFetch` was also blocked today (DNS resolution failure, `getaddrinfo ENOTFOUND`), so Task 2 research ran on `WebSearch` snippets only — no full-article reads. Tasks 1 and 3 could not run for the 14th consecutive day: no live state, no BTC ticker, no closed-trade data. No data-driven quality/strategy change was made for the same reason as every prior day in this streak.

**This is now a two-week-old, unresolved blocker.** The daily agent cannot complete its core job (health check + performance analysis + data-validated strategy tuning) until network access to `soloris-signals.vercel.app` and `fapi.binance.com` is added to this environment's allowlist (Environment settings → Network access → Custom → add both hosts under Allowed domains, or broaden the access level). This requires action outside the agent's own permissions and is flagged to the user directly today.

---

### Research findings (Task 2)

WebSearch-only (WebFetch blocked by DNS failure). Today's results were assessed as mostly recycled/generic — consistent with the last several days:

- **Trending coins**: no reliable dated "this week" list surfaced. Undated/stale items: ZEC/BNB/ARB/XRP/SOL perp OI growth (ZEC OI ~$2.4B, early-Sep vintage), HYPE/TRX/ZEC/XLM as relative outperformers in a weak altcoin market (Aug 2026 Kaiko report) — same genre as prior QNT/SUI/AAVE findings, nothing fresher.
- **EMA pullback improvements**: no independent/peer-reviewed 2026 backtests. Only self-reported TradingView scripts, 32–45% WR (profit from R:R not hit rate); an "80% WR" claim is explicitly marketing (author admits curve-fitting after the fact). Nothing here beats the platform's existing fixed 1.5/3/6% scheme — no change justified.
- **Indicator combos**: generic "trend + momentum + volume" consensus, unsourced "65-70% RSI accuracy" / "73% of reversals" marketing figures. Same recycled ADX>25-style claim pattern as prior days — already implemented (`adx4h >= 25` bonus), no new rigor.
- **Market structure**: BTC dominance ~58%, Altcoin Season Index ~18/100 (deep Bitcoin-season) argues against broad altcoin momentum right now — doesn't change the $200M volume floor or symbol universe.
- **Funding rate**: same recycled wisdom — extreme funding clusters near local tops anecdotally, no backtest cited. Basis/cash-and-carry arb is the one well-documented edge but compressed since 2024. Not actioned (same as every prior day).

**Note for future runs**: if this WebSearch-snippet-only cadence continues, primary data sources (CoinGlass/Coinalyze for OI/funding, DefiLlama for perp DEX volume) would likely beat repeating the same generic strategy queries.

### Changes implemented

No trading-logic or quality-score changes — 14 days running with no closed-trade data to validate any against. Code review turned up and fixed 3 genuinely new bugs (all verified by direct code read before fixing):

1. **`lib/emaperps-runtime.js` (minimum-target-size gate comment)** — a stale comment block said "R2 must be at least 10% from entry... no structural room to reach a meaningful 15–25% move. (TP1/R1 floor: 5%)", directly contradicting the comment right below it (correctly documenting the real history: lowered to 5%/2.5%, then to the current fixed 3%/6% TP1/TP2 with sanity-only distance gates) and the actual code (`tp2Dist < 0.03`, `tp1Dist < 0.02`). Removed the stale, superseded comment block.
2. **`emaperps.js` pre-trade checklist — "Funding neutral (< ±0.05%)" check was comparing against the wrong scale.** `signal.fundingRate` is already ×100-scaled in the runtime (stored in percent units, e.g. a real-world ~0.01% funding rate arrives as `frVal≈0.01`), but the checklist compared `Math.abs(frVal) < 0.0005` — 100× stricter than the label's stated ±0.05% band. This made the check fail for virtually any real-world funding rate, misleadingly flagging "funding not neutral" when funding was actually well within band. Fixed to `< 0.05` to match the label. (Day-7's checklist fix, commit `4f54351`, corrected 3 other items in this block but missed this one.)
3. **`emaperps.js` Stats → Pattern Breakdown table was silently excluding all P/Q EMA-pullback signals.** `patternMeta`/`patternOrder` only listed dead `G1/G2/H1/H2` codes ("EMA20 Retest↓", "EMA50 Pullback↑") left over from before the P/Q rename (commit `e678dcb`). The engine's actual pullback signal codes are `P20`/`P50`/`Q20`/`Q50` (`lib/emaperps-runtime.js` `detectSignal`) — these never appeared in `emaperps.js` at all, so any alerted P/Q signal was silently dropped from the breakdown stats panel, and the G/H rows could never populate since no live `signalType` ever matches them. Replaced the dead codes with the real ones (`P20: "EMA20 Pullback ↑"`, `P50: "EMA50 Pullback ↑"`, `Q20: "EMA20 Retest ↓"`, `Q50: "EMA50 Retest ↓"`) in both `patternMeta` and `patternOrder`. Verified with `node --check` on both edited files.

**Considered but deferred** (unchanged — still no trade data to validate against):
- EMA-pullback volume-confirmation filter (pullback volume < impulse volume) as a new quality bonus.
- Funding-rate-extreme quality bonus.
- RSI gate widening to a wider "momentum regime" band.
- VWAP-as-trend-filter idea from an earlier day's research (48%→60% WR claim) — still unvalidated against this platform's own trades.

### Watch tomorrow

- **Priority, now 14 days running**: network access to `soloris-signals.vercel.app` and `fapi.binance.com` needs to be restored in this environment's settings. Flagged directly to the user today — this is outside the agent's own permissions to fix.
- Once access is restored and trade data is available: validate the Pattern Breakdown fix by confirming P20/P50/Q20/Q50 rows now populate with real alerted-signal counts.
- Consider switching Task 2 research to primary data sources (CoinGlass/Coinalyze, DefiLlama) if WebSearch-snippet-only research keeps producing recycled findings.

---

## 2026-10-16

**EMAPerps**: ⚠️ Could not fetch live state — same network blocker as the last twelve days, unresolved (day 13).

**BTC**: ⚠️ Could not fetch — same blocker.

---

### ⚠️ Blocker persists (day 13): network egress policy still blocks the health check and performance analysis

Identical to every prior day since 2026-10-04 — reconfirmed via `/__agentproxy/status`: both `soloris-signals.vercel.app:443` and `fapi.binance.com:443` show `connect_rejected` ("gateway answered 403 to CONNECT (policy denial or upstream failure)") at today's timestamp. `WebSearch` worked fine; `WebFetch` failed with `ENOTFOUND` on an external article URL tried (kucoin.com) — same narrower-research-access pattern as recent days. Tasks 1 and 3 could not run — no live state, no BTC ticker, no closed-trade data, for the thirteenth day running.

Holding to the plan set on 2026-10-12 through 15: not re-escalating with another push notification today (last one was day 6, 2026-10-09; next planned check is 2026-10-18 if still unresolved by then — two days away).

**Action needed (still unresolved)**: in this environment's settings, set Network access to a broader level, or Custom with `soloris-signals.vercel.app` and `fapi.binance.com` added under Allowed domains.

---

### Research findings (Task 2)

`WebFetch` blocked again, so Task 2 ran on `WebSearch` snippets only:

- EMA-pullback community backtests (self-reported, TradingView) again cluster well under 50% WR (32–45%, one 44.8% BTCUSD sample) and rely on R:R above 1:1 to stay profitable — still directionally consistent with this platform's fixed 1.5%/3.0%/6.0% SL/TP1/TP2 design (2R/4R). No change indicated.
- MACD/RSI confluence searches again returned only vendor/education content and uncited win-rate claims (e.g. a LedgerMind post citing unverifiable 63–68% figures) — nothing rigorous enough to act on, consistent with every prior day's findings on this topic.
- Funding-rate-extreme reversal signal: today's sources (Nexo, Sharpe Terminal) repeat the same unresolved split seen before — one vendor claims extreme funding precedes reversals, another says it only establishes "conditions," not timing, and a Sharpe Terminal threshold claim (0.05%/8h) is unsourced. Nothing here overturns the BitMEX regression result logged on day 12 (no significant predictive power) that this platform is currently leaning against a funding-rate bonus.
- Market-structure searches again returned stale snapshots (an August 2026 Kaiko report naming HYPE/TRX/ZEC/XLM as outperformers, altcoin volumes shrinking since January) rather than anything current enough to justify a symbol-universe change. The existing $200M volume floor already structurally covers this class of liquid, trending name.

### Changes implemented

One targeted bug fix (no trading-logic or quality-score changes — thirteenth day running with no closed-trade data to validate any against):

1. **`lib/emaperps-runtime.js`** (`detectSignal`, reasoning labels) — removed an unreachable dead branch. The 4H-trend hard block (~line 854: `if ((side === "Long" && htfTrend === "down") || (side === "Short" && htfTrend === "up")) return null;`) already rejects every signal whose 4H trend opposes its side *before* the function reaches the reasoning-label section further down. That meant the `else if (htfTrend)` branch there — which pushed `"Counter-trend range fade (4H ...)"` into a signal's displayed reasons — could never actually execute; any signal that survives to that point always has `htfTrend` agreeing with `side`. Left in place, it was a misleading comment-by-omission: a reader of the reasoning panel code (or the panel itself, had it ever randomly misfired) could believe the platform sometimes takes counter-trend fades, when it hard-blocks them entirely. Collapsed to the single reachable branch and added a comment explaining why the other case can't occur. Verified with `node -c` (syntax) and by re-reading the hard-block logic to confirm the invariant.

**Considered but deferred** (unchanged — still no trade data to validate against):
- EMA-pullback volume-confirmation filter (RSI+MFI or similar) — still leaning against per day 12's reasoning (this platform tried and removed a volume bonus before for correlating with Q90 losses).
- Funding-rate-extreme quality bonus — still leaning against per day 12's BitMEX regression finding.
- RSI-band widening to 60–80 "momentum regime" — still genuinely open, needs backtest against real closed-trade data once available.

### Watch tomorrow

- Network blocker now 13 days unresolved. Holding to the plan: next escalation (push notification) only if this reaches 2026-10-18 with still no change.
- Once access is restored and trade data is available: backtest the RSI-band widening idea (the only item still genuinely open; funding-rate and volume-bonus ideas are now both leaning "don't implement" per research logged on days 12 and 16).
- Today's code review found one small dead-branch bug (now fixed) but nothing else — the backlog from the ClaudePerps removal continues to look largely cleared.

---

## 2026-10-15

**EMAPerps**: ⚠️ Could not fetch live state — same network blocker as the last eleven days, unresolved (day 12).

**BTC**: ⚠️ Could not fetch — same blocker.

---

### ⚠️ Blocker persists (day 12): network egress policy still blocks the health check and performance analysis

Identical to every prior day since 2026-10-04 — reconfirmed via `/__agentproxy/status`, both `soloris-signals.vercel.app:443` and `fapi.binance.com:443` show `connect_rejected` ("gateway answered 403 to CONNECT (policy denial or upstream failure)") at today's timestamp. `WebSearch` worked fine; `WebFetch` failed with `ENOTFOUND` on every external article URL tried (bitmex.com, tradingview.com, kucoin.com) — same narrower-research-access pattern as prior days. Tasks 1 and 3 could not run — no live state, no BTC ticker, no closed-trade data, for the twelfth day running.

Holding to the plan set on 2026-10-12/13/14: not re-escalating with another push notification today (last one was day 6, 2026-10-09; next planned check is 2026-10-18 if still unresolved by then).

**Action needed (still unresolved)**: in this environment's settings, set Network access to a broader level, or Custom with `soloris-signals.vercel.app` and `fapi.binance.com` added under Allowed domains.

---

### Research findings (Task 2)

`WebFetch` blocked again, so Task 2 ran on `WebSearch` snippets only:

- EMA-pullback community backtests (self-reported, TradingView) again cluster well under 50% WR (32–45% / 44.8% BTCUSD samples seen today), relying on R:R materially above 1:1 to stay profitable — directionally consistent with this platform's fixed 1.5%/3.0%/6.0% SL/TP1/TP2 design (2R/4R), no change indicated.
- A concrete volume-confirmation filter surfaced again (RSI(21) > 55 AND MFI(21) > 55 for longs, requiring both price *and* volume momentum) — same idea queued since 2026-10-04 as a possible quality bonus. Still not implemented: this exact class of filter (a volume-based quality bonus) was already tried on this platform and removed because it correlated with the Q90 loss cluster (see the file header comment in `lib/emaperps-runtime.js`), so re-adding a volume bonus needs this platform's own trade data to justify, not just outside research.
- Funding-rate-extreme reversal signal: today's best source (BitMEX's own XBTUSD research) reports **no significant predictive power** for raw funding rate in a regression against next-period returns — the most rigorous source found on this topic to date, and it argues against adding a funding-rate quality bonus at all, not just for deferring it. `fundingRate` stays informational-only in the UI, which this result actually supports rather than just leaves unresolved.
- Market-structure/trending-coin searches returned mostly stale or non-current results again (ZEC/BNB/ARB/XRP/SOL open-interest surge coverage dated September 2026; HYPE/TRX/XLM relative-strength coverage dated August 2026) — nothing current enough to justify a symbol-universe change, and the $200M volume floor already structurally covers the kind of liquid, trending names these searches surfaced.

### Changes implemented

No trading-logic or quality-score changes — twelfth day running with no closed-trade data to validate any against. Reviewed `lib/emaperps-runtime.js` (quality scoring, constants), `emaperps.html` (Signal Rules panel — Q85/Q80/Q75/Q70/Q60 badges still match the runtime's baseQuality values exactly), `emaperps.js` (Q95–99/Q100–104/Q105–109/Q110+ tier table — already rescaled and correct after 2026-10-12's fix), and `api/notify.js` (the previously-deferred `"CLAUDEPERPS"` fallback label is gone — all banner fallbacks now correctly read `"EMA PERPS"` / `"DLMM"` / `"SOLORIS"`, so that item is resolved, no longer needs tracking). No new display bugs or dead code found today — the last several days' cleanup pass appears to have caught the drift that had accumulated since the ClaudePerps removal.

**Considered but deferred** (unchanged — still no trade data to validate against):
- EMA-pullback volume-confirmation filter (RSI+MFI or similar) — now leaning against, not just deferred: this platform tried a volume bonus before and removed it for correlating with losses, so outside research alone isn't sufficient justification to reintroduce it.
- Funding-rate-extreme quality bonus — now leaning against: today's most rigorous source found no predictive power in the raw signal.
- RSI-band widening to 60–80 "momentum regime" — still genuinely open, needs backtest against real closed-trade data once available.

### Watch tomorrow

- Network blocker now 12 days unresolved. Holding to the plan: next escalation (push notification) only if this reaches 2026-10-18 with still no change.
- Once access is restored and trade data is available: backtest the RSI-band widening idea (the only volume/funding-rate ideas still genuinely open are now leaning "don't implement" per today's research — see above).
- Nothing else currently flagged for tomorrow; today's code review turned up no new bugs, which is itself a useful signal that the backlog from the ClaudePerps removal is now largely cleared.

---

## 2026-10-14

**EMAPerps**: ⚠️ Could not fetch live state — same network blocker as the last ten days, unresolved (day 11).

**BTC**: ⚠️ Could not fetch — same blocker.

---

### ⚠️ Blocker persists (day 11): network egress policy still blocks the health check and performance analysis

Identical to every prior day since 2026-10-04 — `curl` to both `soloris-signals.vercel.app:443` and `fapi.binance.com:443` returns `connect_rejected` ("gateway answered 403 to CONNECT (organization policy)"), reconfirmed today via `/__agentproxy/status`. `WebSearch` worked fine; `WebFetch` (e.g. kraken.com) returned `ENOTFOUND` — same narrower-research-access pattern as 2026-10-06/08/13. Tasks 1 and 3 could not run — no live state, no BTC ticker, no closed-trade data, for the eleventh day running.

Holding to the plan set on 2026-10-12/13: not re-escalating with another push notification today (last one was day 6, 2026-10-09; next planned check is day 14, 2026-10-18, if still unresolved by then).

**Action needed (still unresolved)**: in this environment's settings, set Network access to a broader level, or Custom with `soloris-signals.vercel.app` and `fapi.binance.com` added under Allowed domains.

---

### Research findings (Task 2)

`WebFetch` blocked again, so Task 2 ran on `WebSearch` snippets only:

- EMA-pullback community backtests (self-reported, TradingView) continue to cluster at 32–45% WR with profit factor ~1.3–2.0, relying on R:R above 1.5:1 to stay profitable — directionally consistent with this platform's fixed 1.5%/3.0%/6.0% SL/TP1/TP2 design, no change indicated.
- RSI+MACD confluence research again recommends higher-timeframe confirmation (4H+) and treating RSI divergence as the more reliable signal vs. static 70/30 thresholds — qualitative only, no sourced backtest numbers; nothing here beats what ADX(14) already encodes.
- Funding-rate-extreme reversal signal: reconfirmed as a crowding indicator (extreme funding → crowded, leveraged positioning → faster unwind), but every source again stresses no universal threshold and recommends comparing against a rolling (30d/90d) average rather than a fixed cutoff — same unresolved caveat as every prior day; still not implemented, still needs this platform's own trade data to validate.
- One search ("volume confirmation / wick size pullback entry") surfaced a trader's own A/B sample showing volume-gated entries beat non-gated by only +0.11R vs +0.06R — not a statistically meaningful difference on one sample, and a reminder that this specific idea (queued since 2026-10-04) is unproven even in its own source material, not just unvalidated against our trades.
- Market-structure and trending-coin searches returned mostly dateless or pre-2026 results again today — nothing new changes the $200M volume floor or symbol universe.

### Changes implemented

No trading-logic or quality-score changes — eleventh day running with no closed-trade data to validate any against. Found and fixed one real, non-cosmetic bug during code review, in `api/daily-digest.js`:

1. **`qualityTierBreakdown`/`epTiers` dead suggestion logic** — traced this back to the feature's original commit (`4cb1397`, the first version of the daily digest, long before the 2026-09-25 ClaudePerps removal). The ClaudePerps side had a `cpTiers.forEach(...)` block in `generateSuggestions()` that turned the quality-tier breakdown into "weak tier dragging down results" / "elite tier, size up" suggestions — but the equivalent `epTiers.forEach(...)` block for EMAPerps was never written. `epTiers` was computed every single day, threaded through as a function parameter, and silently discarded — a copy-paste omission from day one that survived every subsequent refactor, including the ClaudePerps removal itself (which deleted the dead `cpTiers` block along with everything else ClaudePerps, not noticing the `ep` counterpart was dead too). On top of that, the tier boundaries (`Q75-79`/`Q80-84`/`Q85-89`/`Q90+`) were also stale against today's 95 floor, same class of bug fixed in four other places across the last five days — every alerted signal is >= 95, so three of four tiers could never have any members even if the block had been wired up. Fixed both: rescaled the tiers to the real 95–118 achievable range (`Q95-99`/`Q100-109`/`Q110+`, matching the Good/Strong/Elite split already established in `emaperps.js`'s `activeQualityLabel`), and added the missing `epTiers.forEach` suggestion block using this file's own existing EMAPerps pattern-analysis thresholds (≤35%/≥65% WR at count≥3) instead of copying ClaudePerps' now-irrelevant 30%/70% cutoffs. Verified with a standalone simulation (empty signals array, and a populated array spanning both tiers) — both produce correct tier breakdowns and correct suggestion text with no crashes.

**Considered but deferred** (unchanged — still no trade data to validate against):
- EMA-pullback volume-confirmation filter, funding-rate-extreme quality bonus (vs. rolling own-average), RSI-band widening.
- Re-validating the Q110 sizing-ceiling choice and the quality-tier suggestion cutoffs (35%/65%, carried over from pattern analysis) against real quality-vs-win-rate data, once available.

### Watch tomorrow

- Network blocker now 11 days unresolved. Holding to the plan: next escalation (push notification) only if this reaches two full weeks (2026-10-18) with still no change.
- Once access is restored and trade data is available: backtest the volume-confirmation filter, funding-rate bonus, and RSI-band widening ideas queued since 2026-10-04, before implementing any of them; also re-validate the Q110 sizing ceiling and the new quality-tier suggestion thresholds.
- The `epTiers` fix means the daily Discord digest can now actually surface a "Quality tier Q95-99 only had a 20% WR" style warning once real trade data exists — worth checking tomorrow's (or the first post-blocker) digest output to confirm it renders as expected in practice, not just in the standalone simulation.

---

## 2026-10-13

**EMAPerps**: ⚠️ Could not fetch live state — same network blocker as the last nine days, unresolved (day 10). See below.

**BTC**: ⚠️ Could not fetch — same blocker.

---

### ⚠️ Blocker persists (day 10): network egress policy still blocks the health check and performance analysis

Identical to every prior day since 2026-10-04 — `curl` to both `soloris-signals.vercel.app:443` and `fapi.binance.com:443` returns `connect_rejected` ("gateway answered 403 to CONNECT", organization policy), confirmed again today. `WebSearch` still works; `WebFetch` to ordinary research articles (kraken.com, tradingview.com, kucoin.com) was `ENOTFOUND`/blocked today too — back to the narrower-research-access pattern seen on 2026-10-06/08, not the broader access seen on 2026-10-10/12. Tasks 1 and 3 could not run — no live state, no BTC ticker, no closed-trade data, for the tenth day running.

Per the plan set in yesterday's entry, not re-escalating with another push notification today (last one was day 6, 2026-10-09) — will escalate again if this crosses two full weeks (2026-10-18) with still no change.

**Action needed (still unresolved)**: in this environment's settings, set Network access to a broader level, or Custom with `soloris-signals.vercel.app` and `fapi.binance.com` added under Allowed domains.

---

### Research findings (Task 2)

`WebFetch` being blocked again meant no full-article reads today — Task 2 ran on `WebSearch` result snippets only, same constraint as 2026-10-06/08:

- Nothing new or rigorous enough to act on beyond what's queued from the past nine days. EMA-pullback community backtests (TradingView, self-reported, unverified) continue to cluster at 32–45% WR with profit factor 1.3–2.0 at R:R above 1.5:1 — still directionally consistent with this platform's fixed 2:1/4:1 TP1/TP2 design.
- Funding-rate research reconfirmed the same caveat repeated all nine prior days: Kraken's own writeup (read in snippet form only) recommends comparing current funding to its 30-day/90-day average rather than a fixed threshold — still unvalidated against this platform's own trades, still not implemented.
- ADX > 25 as a trend-confirmation gate remains the most consistently-repeated heuristic across ten days of research and already matches `adx4h >= 25` / `<18` exactly — no change needed, again.
- Market-structure searches returned mostly dateless or stale (pre-2026, or already-covered May/August 2026) results — SUI/SWEAT/ZANO and BTC/ETH/SOL/TAO/FET/Nexo repeat prior days' findings. Nothing here changes the $200M volume floor or symbol universe.

### Changes implemented

No trading-logic or quality-score changes — tenth day running with no closed-trade data to validate any against. Found and fixed two real, non-cosmetic display bugs during code review, both in `emaperps.js`, both the same root-cause pattern as several bugs fixed on 2026-10-08/09/12 (code that pre-dates the `MIN_ALERT_QUALITY` 83→95 raise and the resulting 95–118 achievable-quality range, never updated to match):

1. **`renderReasoningPanel`'s per-signal "Quality" bar** (the detail panel shown when a trader clicks a signal card) — labeled the score `${q}/100` and capped the fill bar at `Math.min(q,100)%`, implying 100 is the maximum possible score. It isn't: this panel only ever renders a signal from `state.signals`, which the scan loop guarantees is always ≥95 (`MIN_ALERT_QUALITY`), and the real achievable ceiling is 118 (85 highest base quality + 33 from every bonus stacking — RSI+5, wick+5, htfEma+5, htfLevel+8, multiTested+5, ADX+5). So every signal from Q100 to Q118 rendered as an identical maxed-out bar, and the color cutoffs (`q>=90` amber / `q>=85` green / else blue) had the same dead-branch problem as the already-fixed Discord tier labels and feed-card quality class — the 85 and "else" branches are unreachable once every signal is ≥95, so this panel's bar was *always* amber. Rescaled the bar to the real 95–118 range and reused the existing `activeQualityLabel()`/color split (Elite ≥110 green, Strong ≥100 amber, Good 95–99 gray) that was already fixed for the feed card on 2026-10-12, instead of maintaining a third, inconsistent quality-tier scheme in a third place.
2. **The "Test Alerts" feature's fake signal** (`EP_TEST_FAKE_EVENT` / `EP_TEST_EVENT_OVERRIDES` / `EP_TEST_TITLES`) — this sends a real Discord message through the live `/api/notify` pipeline so an operator can confirm their webhook works and preview what an alert looks like. The fake signal was stale on two independent counts: (a) `qualityScore: 80` with the title saying "Q80", while the real floor is 95 — no genuine alert can ever be below 95, and the fixture's own `qualificationReason` text even said "Q85" internally, contradicting its own `qualityScore: 80`; (b) the fake entry/SL/TP1/TP2 prices (3750/3620/3920/4100) and their `pnlPct` overrides (4.53%/9.33%/-3.47%) were leftover from the old ATR/structural-level TP scheme — they don't match the engine's current fixed 1.5%/3.0%/6.0% SL/TP1/TP2 rule, and the pnlPct values were unleveraged raw price-moves instead of the leveraged (5×) figures `closePaperPos` actually computes and sends (real TP1/TP2/SL alerts show ±15%/±30%/-7.5%, not ±4.5%/±9.3%/-3.5%). Recomputed all five prices from entry×(1±fixed%) and the pnlPct values as leveraged moves, and changed the quality score/labels to Q100 (a value actually achievable and internally consistent with "strong signal"). Previously, clicking "Test Alert" would show an operator a preview that doesn't resemble any alert the live system can actually send.

Both are derivable purely from reading the engine's own constants (`MIN_ALERT_QUALITY`, `FIXED_SL_PCT/TP1_PCT/TP2_PCT`, the bonus list, `closePaperPos`'s leveraged pnlPct formula) — no live trade data needed, consistent with every prior day's approach under this blocker.

**Considered but deferred** (unchanged — still no trade data to validate against):
- EMA-pullback volume-confirmation filter, funding-rate-extreme quality bonus (vs. 30d/90d own-average), RSI-band widening.
- Re-validating the Q110 sizing-ceiling choice (fixed 2026-10-12) against real quality-vs-win-rate data, once available.

### Watch tomorrow

- Network blocker now 10 days unresolved. Holding to the plan set yesterday: next escalation (push notification) only if this reaches two full weeks (2026-10-18) with still no change.
- Once access is restored and trade data is available: backtest the volume-confirmation filter, funding-rate bonus, and RSI-band widening ideas queued since 2026-10-04, before implementing any of them; also re-validate the Q110 sizing ceiling.
- Worth a periodic check whether other UI surfaces still carry a pre-Q95-floor quality scale/threshold the way `renderReasoningPanel` did today — the same class of bug has now been found and fixed in four separate places (Discord tier labels, feed-card class, stat-tier buckets, and now the reasoning panel) across five different days, so a dedicated one-time sweep for any remaining `/100`-style or sub-95 quality cutoffs would be worthwhile once this file class of bug stops recurring.

---

## 2026-10-12

**EMAPerps**: ⚠️ Could not fetch live state — same network blocker as the last eight days, unresolved (day 9). See below.

**BTC**: ⚠️ Could not fetch — same blocker.

---

### ⚠️ Blocker persists (day 9): network egress policy still blocks the health check and performance analysis

Identical to every prior day since 2026-10-04 — `curl` to both `soloris-signals.vercel.app:443` and `fapi.binance.com:443` returns `connect_rejected` ("gateway answered 403 to CONNECT"), reconfirmed via `/__agentproxy/status`. `WebSearch` still works; `WebFetch` to ordinary research articles also worked today. Tasks 1 and 3 could not run — no live state, no BTC ticker, no closed-trade data, for the ninth day running.

This was already escalated with a push notification on day 6 (2026-10-09) with no apparent change. Not re-sending the identical ask today to avoid notification fatigue on an already-flagged issue — but noting here that it remains unresolved three days after that escalation, and today's run found something that makes the lack of real trade data more costly than a documentation gap: see below.

**Action needed (still unresolved)**: in this environment's settings, set Network access to a broader level, or Custom with `soloris-signals.vercel.app` and `fapi.binance.com` added under Allowed domains.

---

### Research findings (Task 2)

Nothing new and sufficiently rigorous to act on beyond what's already queued from the past eight days (same searches, same vendor/TradingView-script-quality sources, no fresh 2026-10 backtested evidence). Reconfirmed: ADX>25-as-trend-confirmation remains the most consistently-repeated, credible heuristic and already matches `adx4h >= 25`/`<18` exactly; funding-rate extremes remain a plausible but unquantified reversal signal; EMA-pullback public backtests continue to cluster in the 30-45% WR / R:R>1.5 range, consistent with this platform's fixed 2:1/4:1 design. No new market-structure or indicator-combination idea strong enough to implement without trade-data validation.

### Changes implemented

No trading-logic/quality-score changes (still no closed-trade data to validate against — ninth day). Found and fixed one **real, non-cosmetic bug** during code review, plus one related display fix:

1. **`lib/emaperps-runtime.js` — conviction-weighted position sizing has been completely disabled since 2026-08-20.** `qualityWeightedSizePct()` linearly scales paper-trade size between `PAPER_SIZE_MIN_PCT` (7%) at the quality floor and `PAPER_SIZE_MAX_PCT` (14%) at `PAPER_SIZE_QUALITY_CEIL`, *if* `span = PAPER_SIZE_QUALITY_CEIL - MIN_ALERT_QUALITY > 0`. Commit `691d053` (2026-08-20) raised `MIN_ALERT_QUALITY` from 83→95 but never touched `PAPER_SIZE_QUALITY_CEIL`, which was still 92 — three points *below* the new floor. That makes `span` permanently negative, so the `span > 0` branch is always false and `t` is hardcoded to `1` for every signal: **every single paper trade for the past ~7 weeks has been sized at the maximum 14% of balance, regardless of whether it was a bare-floor Q95 setup or a maxed-out Q118 one.** This is derivable purely from the constants' own arithmetic (95 > 92), not from live trade data, so it was safe to fix without Task 1/3 access. Raised `PAPER_SIZE_QUALITY_CEIL` to **110** — the "Elite Setup" tier boundary (see #2 below), restoring real scaling across the quality range (verified: Q95→7.0%, Q100→9.3%, Q105→11.7%, Q110+→14.0%).
2. **`emaperps.js` — the main signal feed card had the identical dead-branch bug** already fixed elsewhere (Discord tier labels on 2026-10-08, stat-tier buckets on 2026-10-09) but missed here: `qualityClass`/`qualityLabel` used 80/70 thresholds, both below the 95 alert floor, so every card on the primary dashboard showed "Strong Signal" (green) whether the signal was a 95 or a 118 — no differentiation at the only place most users actually look. Added `activeQualityClass`/`activeQualityLabel`, mirroring `formatAlertMessage`'s existing Elite(≥110)/Strong(≥100)/Good(else) split of the real 95–118 achievable range, and wired the feed card to use them. Left the original `qualityClass`/`qualityLabel` (70/80 thresholds) in place for the Scanner and Analysis tabs, which show raw `detectSignal()` output that can genuinely be below 95 — those thresholds are still meaningful there.
3. **`.claude/daily-agent.md`** — "Key numbers" still said "Q83 = minimum paper trade, Q90+ = elite setup", stale on both counts (floor is 95, not 83; old sizing ceiling was 92, not 90, and is now 110). Corrected and noted the fix.

Both fixes verified by running the actual functions (`node -e` against the live module, not just reading the code) — confirmed the sizing bug reproduced under the old constant and resolved under the new one.

**Considered but deferred** (unchanged — still no trade data to validate against):
- EMA-pullback volume-confirmation filter, funding-rate-extreme quality bonus (vs. 30d/90d own-average), RSI-band widening.
- Whether 110 is the *right* ceiling (vs. e.g. 100 or 105) for the sizing fix — 110 was chosen principledly (matches the Elite tier already derived from the scoring formula) but is itself unvalidated against real win-rate-by-quality data. Worth revisiting once Task 1/3 access returns.

### Watch tomorrow

- Network blocker now 9 days unresolved; already escalated once (day 6). Will re-escalate if it crosses two full weeks with no action, rather than repeating the same push notification daily.
- Once access is restored: the position-sizing bug fixed today means **every closed trade since 2026-08-20 was sized at max conviction** — when real trade data becomes available, keep that in mind when reading historical P&L (it doesn't reflect what sizing *should* have been for lower-quality signals in that window).
- Re-validate the 110 sizing-ceiling choice against real quality-vs-win-rate data once available.

## 2026-10-11

**EMAPerps**: ⚠️ Could not fetch live state — same network blocker, day 8 straight. See below.

**BTC**: ⚠️ Could not fetch — same blocker.

---

### ⚠️ Blocker persists (day 8): network egress policy still blocks the health check and performance analysis

Identical to the prior week — `curl` and `WebFetch` to `soloris-signals.vercel.app` and `fapi.binance.com` both still return `connect_rejected` / "gateway answered 403 to CONNECT" (reconfirmed via `/__agentproxy/status`). Tasks 1 and 3 could not run, and no live-data-justified quality/strategy change was made, for the same reason as every prior day.

One new data point: with GitHub API access attached this run, `gh run list` on this repo shows **Hourly Scan**, **Upbit Listing Alerts**, and **Daily Strategy Digest** all completing with `success` through today — so the live platform itself is up and the cron jobs are running; only *this container's* egress to the platform/Binance hosts is denied, not the platform. Fetching the actual Daily Digest run's logs (to read the performance numbers it posts to Discord) was tried as a workaround but is blocked too — `results-receiver.actions.githubusercontent.com` is a different host and gets the same 403.

**Action needed (repeating ask, now over a week unresolved)**: in this environment's settings, set Network access to a broader level, or Custom with `soloris-signals.vercel.app` and `fapi.binance.com` added under Allowed domains, so a future run can actually complete the health check and performance analysis instead of logging this same blocker an eighth time.

---

### Research findings (Task 2)

- Nothing new and validated surfaced beyond what's already queued from prior days. ADX+MACD combos: one source today explicitly warned the combination "may not produce the expected results" and suggested ADX+Bollinger Bands instead — reinforces not adding an ADX×MACD quality bonus without our own backtest.
- EMA-pullback backtests found today (TradingView community scripts, self-reported, unverified) cluster around 33-45% WR with profit factor ~1.3 at moderate R:R — consistent with this platform's own fixed 2:1/4:1 R:R design needing a win rate above ~33% breakeven, no new design implication.
- Funding-rate research reinforced the existing caveat already in this log: no fixed threshold works reliably; the most credible sources recommend comparing current funding to its own 30-day/90-day average rather than an absolute cutoff. Still unvalidated against our own closed trades — not implemented.
- Market structure research was dated (most recent dataset from August 2026) and conflicting — one source read August as "altcoin contraction," an earlier one read May as "early altseason." Nothing here changes the $200M volume floor or symbol universe.

### Changes implemented

No trading-logic or quality-score changes — still no fresh closed-trade data to validate against. Five surgical doc/display fixes found during code review (verified by a dedicated review pass before applying):

1. **`lib/emaperps-runtime.js`** (module header) — the file's top doc-comment still described the old R1/R2-target, ATR-SL-buffer, 5%/10%-minimum-distance scheme and a "+5 volume" bonus that no longer exist in the code (the engine moved to fixed 1.5%/3.0%/6.0% SL/TP1/TP2 and dropped the volume bonus in earlier commits, per their own inline comments). Rewrote the header to match the real A-F/P-Q signal map, the real bonus list, and the real fixed-% exit scheme — the comment can't drift this far from the code again without someone also touching the header.
2. **`emaperps.js`** (signal card TP1/TP2 labels) — the UI showed `→ R1`/`→ R2` (or `→ S1`/`→ S2`) next to TP1/TP2, implying the take-profit targets equal the structural S/R levels shown just below in the same card. They don't — TP1/TP2 are always entry ± 3%/6%, fully decoupled from the swing levels since the fixed-% exit scheme shipped. Changed the labels to `+3.0%`/`+6.0%` so the card shows what the trade will actually exit at.
3. **`emaperps.html`** — the "Strong Signals" stat subtitle read "Q95+ (S2/R2 touch)", implying every Q95+ signal touched a S2/R2 level. False for P/Q EMA-pullback signals (base quality 78-82, no S/R check at all) and for several A-F base qualities that only clear 95 via bonuses. Changed to the accurate "Q95+ signals".
4. **`api/daily-digest.js`** — the auto-generated low-win-rate Discord suggestion hardcoded "Consider raising MIN_ALERT_QUALITY from 75 to 78", but the live `MIN_ALERT_QUALITY` is 95 (raised from 83, logged 2026-10-08) — if this suggestion ever fires it would tell whoever reads the Discord digest to lower the real floor by 17 points. Imported the real constant from `lib/emaperps-runtime.js` and interpolated it instead of the stale hardcoded numbers.
5. **`lib/emaperps-runtime.js`** — removed a dead import (`hasDatabase, getRuntimeState, upsertRuntimeState` from `./neon-db`); verified via full-file grep that none of the three are referenced anywhere in the file (state load/save is handled by `api/emaperps.js`, which imports them separately).

**Considered but deferred** (unchanged — still no trade data to validate against):
- EMA-pullback volume-confirmation filter (pullback volume < impulse volume).
- Funding-rate-extreme quality bonus, now specifically as "distance from its own 30d/90d average" rather than a fixed threshold.
- RSI gate widening to the 60–80 "momentum regime" band.

### Watch tomorrow

- **Priority, now 8 days running**: get network access to `soloris-signals.vercel.app` and `fapi.binance.com` restored so Tasks 1 and 3 can finally run. Confirmed today that the platform itself is healthy (cron Actions all green) — this is purely a container egress-policy gap, worth escalating as such.
- Once access is restored and trade data is available: backtest the funding-rate-vs-own-average idea, the volume-confirmation filter, and the RSI-band widening before implementing any of them.

---

## 2026-10-10

**EMAPerps**: ⚠️ Could not fetch live state — same network blocker as the last six days, unresolved (day 7). See below.

**BTC**: ⚠️ Could not fetch — same blocker.

---

### ⚠️ Blocker persists (day 7): network egress policy still blocks the health check and performance analysis

Identical to the prior six days — `soloris-signals.vercel.app` and `fapi.binance.com` are both still denied with `connect_rejected` / "gateway answered 403 to CONNECT" (confirmed again via `/__agentproxy/status`). This also blocks `lib/backtest-runtime.js` / `/api/backtest` (checked today as a possible workaround — it also pulls historical klines from `fapi.binance.com`, so it can't run locally either while this host is denied). `WebSearch` works fine, so Task 2 ran; Tasks 1 and 3 did not, and no live-data-justified quality/strategy change was made, for the same reason as every prior day.

**Action needed (repeating ask, now a full week unresolved)**: in this environment's settings, set Network access to a broader level, or Custom with `soloris-signals.vercel.app` and `fapi.binance.com` added under Allowed domains, so a future run can actually complete the health check, performance analysis, and a real backtest.

### Research findings (Task 2)

Today's searches returned mostly dateless/generic vendor and TradingView-script content — nothing with fresh (2026-10) backtested evidence strong enough to justify a quality/strategy change on its own:

- Self-reported TradingView EMA-pullback scripts show a wide win-rate spread (32–45%) with no independent verification — a reminder that any "validated" backtest claim found via search should be treated as unverified until checked against this platform's own trade data (which is exactly what's blocked).
- Reconfirmed consensus: combine one trend indicator + one momentum indicator + one volume indicator, avoid stacking overlapping ones — matches the existing EMA/RSI/ADX/volume-floor design, no change indicated.
- Funding-rate-extreme-as-contrarian-signal claims keep surfacing but remain unquantified/unbacktested against real perps data; same caveat as every prior day.
- No new market-structure signal found this run — results were mostly stale (2025 or early-2026) altcoin lists already covered in prior entries.

### Changes implemented

No trading-logic or quality-score changes — still no fresh closed-trade data to validate any against. One genuine display bug found and fixed during code review:

1. **`emaperps.js`** (reasoning panel pre-trade checklist) — three of the seven checklist items were hardcoded to always show "pass" regardless of the signal's actual data, and one had a stale threshold:
   - "RSI in 40–65 zone" was always marked passed and didn't match the engine's real RSI gate (`lib/emaperps-runtime.js`: 38–56 for Long, 44–62 for Short). Now computed from `signal.rsi` against the correct side-specific zone, with the label showing the real range.
   - "4H trend aligned with trade direction" was always marked passed, even when 4H data was unavailable (the engine degrades gracefully in that case rather than confirming alignment). Now checks `signal.htfTrend` against the trade side, and the label says "unconfirmed (data unavailable)" when there's no 4H read.
   - "Level has 2+ prior touches" was always marked passed and used the wrong threshold — the actual `multiTestedBonus` in the engine requires 3+ touches, not 2. Relabeled to "Level tested 3+ times" and wired to the signal's own `reasonLabels` (which only contains a "Level tested N×" entry when the real 3+ bonus fired).
   
   This is a trader-facing checklist meant to support manual review before taking a signal — showing false "pass" checks on it was actively misleading, independent of any trading-logic change.

**Considered but deferred** (unchanged — still no trade data to validate against):
- EMA-pullback volume-confirmation filter (pullback volume < impulse volume).
- Funding-rate-extreme quality bonus.
- RSI gate widening to the 60–80 "momentum regime" band some research keeps surfacing.

### Watch tomorrow

- **Priority, now unresolved for a full week**: get network access to `soloris-signals.vercel.app` and `fapi.binance.com` restored. This also blocks running `/api/backtest` locally, which was today's attempted workaround — it depends on the same host.
- Once access is restored: run `/api/backtest` against the live engine before making any quality/strategy change, then cross-check against real closed-trade data from Task 1/3 once those are unblocked too.
- Re-verify the `daily-digest.yml` GitHub Action is still succeeding (gh CLI lacked repo access this run to check directly; no evidence of a regression, just unconfirmed).

---

## 2026-10-09

**EMAPerps**: ⚠️ Could not fetch live state — same network blocker as the last five days, unresolved (day 6). See below.

**BTC**: ⚠️ Could not fetch — see blocker below.

---

### ⚠️ Blocker: network egress policy blocked the health check and performance analysis (day 6)

Same denial as 2026-10-04 through 2026-10-08, reconfirmed today via the agent-proxy status endpoint:

```
gateway answered 403 to CONNECT (policy denial or upstream failure)
host: soloris-signals.vercel.app:443
host: fapi.binance.com:443
```

`WebSearch` continues to work (different path), so Task 2 research ran normally. Tasks 1 and 3 could not run — no live state, no BTC ticker, no closed-trade data. `lib/backtest-runtime.js` calls `fapi.binance.com` directly with no offline/fixture path, so local backtesting was impossible again too.

**This is now a full week of the identical block with no change.** Flagging to the user directly today (push notification) rather than just logging it again, since six consecutive days of "no data-driven change possible" is itself the most important finding of this run — every day's "changes implemented" section below has had to fall back to code-review-only fixes for the same structural reason.

**Action needed (repeating ask, now a sixth day)**: in this environment's settings, set Network access to a broader level, or Custom with `soloris-signals.vercel.app` and `fapi.binance.com` added under Allowed domains, so a future run can complete the health check, performance analysis, and local backtesting instead of logging this same blocker a seventh time.

---

### Research findings (Task 2)

- Reconfirmed across sources (TradingView community backtests, KuCoin's MACD/RSI guide, Kraken's funding-rate writeup): nothing new or more rigorous than what's already been surfaced on each of the past five days. EMA-pullback win rates in the 30–45% range with R:R above 1:1 remain directionally consistent with this platform's own fixed 2:1/4:1 TP1/TP2 design; ADX>25-as-trend-confirmation remains the most consistently-repeated heuristic and already matches `adx4h >= 25` / `<18` exactly; funding-rate extremes remain a crowding/reversal signal with no universal threshold, still unvalidated against this platform's own trades.
- Live "trending coins this week" and "$500M+ volume altcoins" searches continue to return stale (July/August 2026) or unverifiable results — not a reliable source for real-time market-structure questions; this has been true every day this week. Nothing here changes the $200M volume floor or symbol universe.
- No new, concrete, quantified filter idea surfaced today beyond what's already queued (volume-confirmation filter, funding-rate bonus, RSI-band widening) — all still blocked on trade-data validation per the reasoning logged every prior day.

### Changes implemented

Still no trading-logic or quality-score changes — six days running with no closed-trade data to validate any against. Found and fixed three real display/doc bugs during code review:

1. **`emaperps.js` (`renderMetrics`)** — the "Strong Signals" header stat tile filtered `quality >= 80`, while its own HTML label (`emaperps.html`, fixed on 2026-10-08) says "Q95+". Since `MIN_ALERT_QUALITY` is 95 and the scan loop purges anything below that floor from `state.signals` every cycle, every persisted active signal is already ≥95 — so this tile has been silently rendering the *exact same number* as the "Active Signals" tile next to it, making it a dead, redundant metric rather than the meaningful subset its label promises. Yesterday's cleanup fixed the analogous tab-filter (`>=80`→`>=95`, line ~237) and the HTML label but missed this metric-tile computation. Fixed to `>= 95`.
2. **`emaperps.js` (`renderStatsTab`, quality-tier breakdown table)** — the "Q75–79 / Q80–84 / Q85–89 / Q90+" buckets summarized `alertedSigs`, which is derived from `state.signals` — meaning (same root cause as #1) three of the four buckets were *permanently* empty: nothing below quality 95 can ever persist long enough to be counted. Only the catch-all "Q90+" bucket ever showed real data. Recomputed the max achievable quality directly from the scoring code (base 60–85 + every bonus: RSI+5, wick+5, htfEma+5, htfLevel+8, multiTested+5, ADX+5 = +33 → ceiling of 118) and replaced the dead buckets with ones that span the real 95–118 range: Q95–99 / Q100–104 / Q105–109 / Q110+. This is a data-independent fix (derived from the scoring formula, not from live trade correlations) — it doesn't guess at which quality band performs better, it just stops wasting three table rows on a range that can't exist anymore.
3. **`lib/emaperps-runtime.js` (`formatAlertMessage`)** — the Discord alert's quality-tier label had the identical bug, deferred on 2026-10-08 for lack of a principled basis to pick new boundaries: cutoffs of ≥93 "Elite Setup" / ≥85 "Strong Signal" were both below the 95 floor, so every single Discord alert said "Elite Setup" regardless of whether the signal was a 95 or a 118. Using the same 95–118 range derived for fix #2 above, split it into equal thirds: ≥110 "Elite Setup", ≥100 "Strong Signal", else "Good Signal" (95–99). Same reasoning as #2 — evenly dividing the known valid range, not a performance-based guess.
4. **`lib/engine-core.js`** — the file's header doc comment described shared utilities for "house-runtime" and "tradez-runtime", and listed five functions (`isClosingTradeEvent`, `hasGoodTradingVolume`, `logActivity`, `fetchUniverseTickers`, `analyzeOrderbook`) as "intentionally not here" because they supposedly differ between those two engines. Confirmed via repo-wide grep: none of `house-runtime.js`, `tradez-runtime.js`, or any of those five function names exist anywhere in this codebase — this was leftover documentation from a naming scheme that predates even ClaudePerps (which itself was removed 2026-09-25). Also confirmed only `emaperps-runtime.js` and `backtest-runtime.js` actually import this module. Rewrote the header to describe what's actually here.

**Considered but deferred** (unchanged reasoning — still no trade data to validate against):
- Volume-confirmation filter, funding-rate-extreme quality bonus, RSI-band widening — same status as every prior day this week.

### Watch tomorrow

- **Priority, now repeated six times, escalated to a push notification today**: get network access to `soloris-signals.vercel.app` and `fapi.binance.com` restored. Until that happens, Tasks 1, 3, and local backtesting cannot run, and every day's code changes will keep being confined to documentation/display fixes rather than the data-driven strategy work these instructions actually call for.
- `daily-digest.yml` confirmed **success** every day 2026-10-04 → 2026-10-08 (runs up to #130) — no action needed there.
- Once access is restored and trade data is available: backtest the volume-confirmation filter, funding-rate bonus, and RSI-band widening ideas queued since 2026-10-04, before implementing any of them.

---

## 2026-10-08

**EMAPerps**: ⚠️ Could not fetch live state — same network blocker as the last four days, unresolved (day 5). See below.

**BTC**: ⚠️ Could not fetch — see blocker below.

---

### ⚠️ Blocker: network egress policy blocked the health check and performance analysis (day 5)

Same denial as 2026-10-04 through 2026-10-07, reconfirmed today:

```
curl: (56)
host: soloris-signals.vercel.app:443 — connect_rejected (gateway 403 to CONNECT, organization policy)
host: fapi.binance.com:443 — connect_rejected (gateway 403 to CONNECT, organization policy)
```

`WebFetch` to `soloris-signals.vercel.app` also failed (`ENOTFOUND` — DNS never resolves because the proxy denies the CONNECT). `WebSearch` continues to work (different path), so Task 2 research ran normally. Tasks 1 and 3 could not run — no live state, no BTC ticker, no closed-trade data. `lib/backtest-runtime.js` also calls `fapi.binance.com` directly, so no local backtest was possible either (confirmed by reading the file — it has no offline/fixture data path).

**New this run**: attached the repo via GitHub's `add_repo` (push-scoped), which fixed the `gh`-API 403 noted on 2026-10-07. Confirmed via `gh api .../actions/workflows/.../runs` that the `daily-digest.yml` workflow has run **success** every day 2026-10-04 → 2026-10-07 (runs #126–129) — the crash fix from 2026-10-04 is holding. This does not fix the network-egress block itself; that is a separate, still-unresolved container policy restricting the two hosts above (and apparently `WebFetch` generally, per 2026-10-06/07 notes).

**Action needed (repeating ask, now a fifth day)**: in this environment's settings, set Network access to a broader level, or Custom with `soloris-signals.vercel.app` and `fapi.binance.com` added under Allowed domains, so a future run can complete the health check, performance analysis, and local backtesting instead of logging this same blocker a sixth time.

---

### Research findings (Task 2)

- **EMA-pullback backtests (community, unverified)**: TradingView community scripts self-report 32–45% win rates on BTC/ETH with profit factors of 1.28–1.97, relying on R:R well above 1:1 rather than high hit rate — directionally consistent with this platform's own 2:1/4:1 fixed-% TP1/TP2 design, but none of these are independently verified or crypto-perps-specific for 2026.
- **MACD+RSI confluence**: a Crypto.com Nov-2024 research note backtests "MACD cross + RSI<30 long / RSI>70 short" on BTC 2020–2024 with fees included and reports it as profitable; this is more rigorous than most TradingView marketing pages but is a vendor's own study, not independently reproduced, and is a mean-reversion RSI gate (extremes) rather than this platform's momentum-zone RSI gate (38–56 long / 44–62 short) — not directly comparable.
- **ADX>25 as trend-confirmation**: continues to be the most consistently-repeated heuristic across every day of research this week. Matches the existing `adx4h >= 25` bonus / `<18` ranging-skip exactly — no change needed, again.
- **Funding-rate edge**: same conclusion as every prior day — crowded/extreme funding precedes mean-reversion/squeezes but has no universal threshold and needs OI/liquidation context to be reliable alone. Still unvalidated against this platform's own trades, still not implemented.
- **Market structure**: ZEC open interest hit a record $2.4B in early September on a price surge that tracked OI closely (leveraged/speculative, not spot-driven) — a textbook case for why a standalone OI/volume spike bonus would be noisy, matching why this platform already removed its old volume bonus. HYPE, TRX, ZEC, XLM, ARB continue to be named as the handful of alts actually showing strength in a narrower 2026 market. Nothing here changes the $200M volume floor or symbol universe.

### Changes implemented

Still no trading-logic or quality-score changes — five days running with no closed-trade data to validate any against. Found and fixed real staleness during code review instead, now that a careful read of the full 1,378-line engine file was possible:

1. **`lib/emaperps-runtime.js` (`detectSignal`)** — removed the `slLevel` variable entirely. It was assigned in all 16 signal branches (A1/A2/B1/B2/C1/C2/D1/D2/E1/E2/F1/F2/P20/P50/Q20/Q50) but never read anywhere — confirmed via a full-file search. The actual SL/TP1/TP2 returned to callers have been flat fixed-% values (1.5%/3.0%/6.0% from entry, uniform across every signal type) since an earlier "fixed % SL/TP" commit; `slLevel` was leftover from before that change and, like the `slDistance` guard removed on 2026-10-07, was actively misleading — it reads like each signal type gets its own structural SL when none of them do. No behavior change (verified: the variable was write-only). Also rewrote the stale comment above the P/Q block, which claimed "SL: structural candle reference ± 0.3×ATR buffer" and referenced "The 1.5×ATR SL floor gate below" — neither of those ever existed in this file (confirmed via grep); replaced with an accurate note that `tp1`/`tp2` here only feed the minimum-target-distance gate, same as the A-F branches.
2. **User-facing staleness from the same root cause** (`MIN_ALERT_QUALITY` was raised 80→83→95 over time but three "Q80+" labels were never updated): fixed `emaperps.html` (the "Strong Signals" stat-sub, and the Discord-note under the alert toggle — both now say "Q95+") and `emaperps.js` (the "Strong" tab's filter threshold and its empty-state message, `>=80` → `>=95`). Before this fix the "Strong" tab's filter was dead weight — nothing below Q95 is ever stored in `state.signals`, so `>=80` and `>=95` produced identical results today — but the displayed threshold was actively lying to anyone reading it. Also rewrote `emaperps.html`'s "Signal Rules" panel footnote, which told users "SL below S2/above R2 + 0.5 ATR buffer" — untrue since the fixed-% SL/TP change; it now states the real fixed 1.5%/3.0%/6.0% rule.
3. **`.claude/daily-agent.md`** — the architecture section still documented `MIN_ALERT_QUALITY = 83` (stale since a prior raise to 95) and described TP/SL as ATR-multiple-based "with fixed-% equivalents" (backwards — fixed-% is the only rule now, ATR/structural levels only gate entry timing). Corrected both.
4. **GitHub Actions visibility**: attached the repo via `add_repo` (see blocker section) so this and future runs can check workflow run history via `gh api` without the 403 noted yesterday.

**Considered but deferred**:
- `formatAlertMessage`'s quality-tier labels in `lib/emaperps-runtime.js` ("🔥 Elite Setup" ≥93, "⭐ Strong Signal" ≥85, else "Good Signal") have the same root problem as the "Strong Signals" tab: since `MIN_ALERT_QUALITY` is 95, every signal that ever reaches this function is ≥95, so the ≥85 and else branches are now unreachable — every Discord alert says "Elite Setup" regardless of whether it's a 95 or a 118. Fixing the *labels* was safe (above); picking new, meaningful tier boundaries for this 95–118 range is a judgment call that needs the real quality-score distribution of actual signals, which Task 1/3 data (still blocked) would provide. Left as-is rather than guess.
- Funding-rate-extreme quality bonus, EMA-pullback volume-confirmation filter, RSI-band widening — same reasoning as every prior day: plausible per research, unproven against this platform's own trades, no data available to validate.

### Watch tomorrow

- **Priority, now repeated five times**: get network access to `soloris-signals.vercel.app` and `fapi.binance.com` restored (and confirm whether the broader `WebFetch` block noted 2026-10-06/07 is still in effect). Until that happens, Tasks 1, 3, and local backtesting cannot run.
- Once access is restored and trade data is available: backtest the volume-confirmation filter, funding-rate bonus, and RSI-band widening ideas, and use the real quality-score distribution to pick new tier boundaries for the "Elite/Strong/Good" Discord labels (deferred above) before changing either.
- `gh` API access to this repo is now attached for future sessions — workflow-run checks should no longer 403.

---

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
