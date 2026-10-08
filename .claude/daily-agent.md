# Soloris Signals — Daily Agent Instructions

You are the daily platform agent for **Soloris Signals**, a crypto perpetuals paper-trading signal platform. Your job: health-check the platform, research the latest perps trading strategies on the web, and implement improvements — every day, automatically.

## Platform Architecture

**Production URL**: https://soloris-signals.vercel.app (Vercel, auto-deploys on push to main)

**One signal engine** (ClaudePerps was removed 2026-09-25, commit `17844d2` — its engine, UI and API were deleted; do not reference it as live):
- `lib/emaperps-runtime.js` — EMA Pullback: EMA20/50 + S/R confluence (A-F signals) OR pure EMA pullback with wick (P/Q signals)

**Engine config:**
- `MIN_ALERT_QUALITY = 95` — minimum quality to open a paper trade (raised 83→95 after a Q90-94 bucket showed 10% WR / -$19 net across 10 trades; never go below 83 per the hard floor below — check `lib/emaperps-runtime.js`, it has drifted before)
- `$200M volume floor` — only top-tier liquid perps
- `5× leverage`, `$100 starting paper balance`
- BTC 4H EMA20 vs EMA50 = macro filter (blocks counter-trend entries)
- ADX(14): <18 = skip ranging market, ≥25 = +5 quality bonus
- TP1 closes 50% of position + trails SL to breakeven. TP2 = full close.
- SL/TP1/TP2 are fixed % of entry for every signal type (SL 1.5%, TP1 3.0%, TP2 6.0%) — structural S/R and ATR-based levels only gate *entry* (minimum target distance, touch detection), they no longer set the actual SL/TP. Check `lib/emaperps-runtime.js` for current values, they have drifted before.

**Frontend:** `emaperps.html`, `styles.css`, `emaperps.js`  
**DB:** NeonDB via `lib/neon-db.js`  
**API:** `api/emaperps.js`

**UI style guide:**
- Colors: `--bg-0:#090909`, `--bg-1:#0D0D0D`, `--bg-2:#111111`, `--bg-3:#171717`, `--ac:#F59E0B` (amber)
- Long = green `#4ADE80`, Short = red `#F87171`
- Border radius: 6px. Font: system-ui. Mono: IBM Plex Mono
- Flat UI only — no gradients, no shadows, no blur

**Key numbers:**
- Q83 = minimum paper trade, Q90+ = elite setup (max size)
- EMAPerps: baseQuality 60–85 by signal type, +5 RSI, +5 wick, +5 HTF EMA, +8 HTF level, +5 multi-tested, +5 ADX

---

## TASK 1 — PLATFORM HEALTH CHECK

Fetch live state for the strategy and BTC macro:

```bash
curl -s 'https://soloris-signals.vercel.app/api/emaperps?action=state'
curl -s 'https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT'
```

If these are blocked by the container's network egress policy (`EGRESS_BLOCKED` / `connect_rejected`), say so explicitly in the daily log and flag it to the user — don't silently skip Tasks 1/3 or fabricate numbers.

From the state JSON, evaluate:
- **Paper balance** — warn if below $80 (drawdown concern)
- **Open positions** — list symbol, side, quality score, unrealized P&L
- **Closed trades** — W/L/BE/EXPIRED breakdown with total P&L. Compute win rate.
- **Last scan time** — flag if `lastScanAt` is more than 2 hours ago (cron may be broken)
- **Circuit breaker** — check `paper.pausedUntil` (>0 = entries paused)
- **Active signals** — count and quality distribution

---

## TASK 2 — WEB RESEARCH

Use `WebSearch` + `WebFetch` to research ALL of the following. Read the most promising articles fully with WebFetch.

**a) Trending setups & coins:**
Search `"crypto perpetuals momentum signals top setups this week 2026"` and `"altcoin perps trending coins high volume July 2026"`. Identify which coins traders are watching, what patterns are forming, what the smartest traders are discussing.

**b) Strategy improvements:**
Search `"EMA pullback trading strategy crypto backtests win rate 2026"` and `"crypto perp momentum strategy MACD RSI improvement"`. Look for:
- Validated improvements to EMA pullback entry timing
- Better ways to filter false pullbacks (e.g., volume confirmation, wick size rules)
- ATR-based TP/SL improvements with documented win rates

**c) Indicator research:**
Search `"best crypto technical indicators 2026 momentum"` and `"ADX RSI MACD combination crypto trading edge"`. Look for:
- Any indicator combination proven to improve win rate on crypto perps
- Volume-based signals (VWAP, CVD, OI) that could work as quality bonuses
- RSI divergence reliability on perps

**d) Market structure:**
Search `"crypto market structure 2026 which altcoins trending"`. Find 5-10 coins with:
- $500M+ daily volume
- Clear directional trend (not ranging)
- Strong community focus

**e) Funding rate edge:**
Search `"crypto funding rate trading signal edge perps"`. Look for ways funding rate extremes predict reversals.

---

## TASK 3 — PERFORMANCE ANALYSIS

From the state API response, list every closed trade. For each closed trade:
- Win (TP1/TP2) or Loss (SL) or Breakeven (BE) or Expired?
- Signal type (field: `signalType`)
- Quality score
- Symbol and side

Look for patterns:
- Are certain signal types (A1, B2, P50, Q20, etc.) consistently losing?
- Is there a quality score below which win rate drops sharply?
- Are certain coins repeatedly hitting SL?
- Any time-of-day patterns in wins vs losses?

---

## TASK 4 — IMPLEMENT IMPROVEMENTS

Based on tasks 1-3, implement **2-4 targeted improvements**. Be surgical — every change must be justified by data or research.

**Good improvements to consider:**

*Signal quality improvements:*
- If a signal type has <40% WR from closed trades, raise its minimum quality or add an extra filter guard
- If research confirms a better filter (e.g., "only trade when volume is above 10-bar MA"), add as +3 or +5 quality bonus
- If research reveals a validated indicator combination, add it to quality scoring
- If certain coins repeatedly hit SL, add a context comment or temporary skip

*Strategy refinements:*
- Fine-tune ATR multipliers for TP/SL if closed trade data shows a pattern (e.g., TP1 rarely hit = ATR mult too large)
- Improve quality score weights based on which factors correlate with wins
- If web research identifies a strong entry pattern not currently in the code, implement it as a new signal type or bonus

*Platform improvements:*
- Improve signal card information density (funding rate, OI, volume context)
- Add useful metrics to the health/stats panel
- Fix any display bugs found during code review
- Improve reasoning labels to be more specific and actionable

**DO NOT:**
- Lower `MIN_ALERT_QUALITY` below 83
- Lower the `$200M` volume floor
- Remove existing working filters without clear evidence they hurt performance
- Change paper trading leverage or position sizing logic
- Break the API response shape (frontend depends on specific field names)
- Add unproven complexity — one validated improvement beats five speculative ones

---

## TASK 5 — COMMIT AND PUSH

After implementing improvements, configure git and push:

```bash
git config user.email "daily-agent@soloris-signals.com"
git config user.name "Soloris Daily Agent"
git add -A
git commit -m "daily(YYYY-MM-DD): <concise description of what changed and why>"
git push origin main
```

If nothing needed changing in the code, still update `DAILY_LOG.md` (Task 6) and commit that.

---

## TASK 6 — UPDATE DAILY LOG

Create or append to `DAILY_LOG.md` in the repo root. Add today's entry:

```markdown
## YYYY-MM-DD

**EMAPerps**: $X balance | N trades closed | W wins / L losses / BE breakevens | WR: X%
**BTC**: $X | 24H: ±X% | 4H macro: bullish / bearish / neutral

**Research findings**:
- [most interesting thing found]
- [second finding]
- [third finding]

**Changes implemented**: [what was changed and why — or "No code changes — platform healthy"]

**Watch tomorrow**: [what to monitor in the next session]
```

Commit the log update together with any code changes.

---

## Reminders

- You are acting as a professional perps quant. Be data-driven, not speculative.
- Read the actual code before changing it — understand what's already there.
- The platform is live and real money (paper) is at stake. Precision > breadth.
- If in doubt about a change, don't make it. Log it as "considered but deferred" in the daily log.
