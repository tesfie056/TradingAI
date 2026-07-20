# Version 1 — Simple Auto Paper Trading Plan

**Goal:** Simple automated paper trading only: **BUY → monitor → SELL** round trips.  
**Hard rules:** Paper-only · U.S. stocks · long-only · no live trading · no ML training yet · safety always overrides the daily 3-trade target.

**Source review:** `.cursor/handoffs/current-project-status.md`  
**Stopped after:** Milestone **V1-8 tooling + after-hours preflight** (V1-1–V1-7 complete; V1-8 Stage A **not passed** — awaiting RTH supervised paper evidence)

---

## Milestone V1-1 — Stabilize the current project

### Objective

Restore a green verification/build baseline, surface unprotected positions clearly, inspect the existing Alpaca paper exposure without auto-modifying it, and confirm Emergency Stop ≠ Close All.

### Existing code reused

- `src/lib/trading/emergency.ts` — Emergency Stop vs Close All separation
- `src/lib/trading/reconcile.ts` — orphan / unprotected detection
- `src/lib/auto-trade/runtime-settings/defaults.ts` — `maxTradesPerDay` default **3**
- `src/components/auto-trade/AutoTradePageView.tsx` — Auto Trade UI
- Existing `scripts/verify-*.ts` suite

### Files changed

| File | Change |
|------|--------|
| `scripts/verify-phase6.ts` | Expect default `maxTradesPerDay` **3** (not 5); clear soak env |
| `scripts/verify-auto-trade-risk.ts` | Match UI Close All wording; assert Emergency Stop never calls `closeAllPositions(`; require `UnprotectedPositionsBanner` |
| `scripts/verify-auto-trade-controls.ts` | Forbid `window.confirm(`/`alert(`/`prompt(` calls (comments allowed); assert Emergency Stop does not liquidate |
| `src/components/ui/UnprotectedPositionsBanner.tsx` | **New** — always-visible unprotected position alert |
| `src/components/auto-trade/AutoTradePageView.tsx` | Mount banner; clarify Emergency Stop / Close All copy |
| `scripts/inspect-paper-positions.ts` | **New** — read-only Alpaca paper position/order inspector |

### Exact fixes (tests)

1. **verify:phase6** — Intended default daily trade cap is **3** via runtime settings (`buildRuntimeSettingsFromEnv`). Test expected stale value **5**.
2. **verify:auto-trade-risk** — UI uses “Close All Positions”; test required exact lowercase “Close all positions”. Also strengthened Emergency Stop / banner checks.
3. **verify:auto-trade-controls** — Comment text contained `window.confirm`, which failed a naive substring assert. Now only rejects actual `window.confirm(` calls.

Safety was **not** weakened to pass tests.

### Tests added / updated

- Updated the three failing verifies above.
- Added assertions that `activateEmergencyStop` does not call `closeAllPositions(`.
- Added assertions that `UnprotectedPositionsBanner` exists and is used on Auto Trade.

### Test results (2026-07-15)

**All 27 verify scripts: PASS**

```
PASS verify:phase1
PASS verify:phase2
PASS verify:phase2.5
PASS verify:phase3
PASS verify:phase3.5
PASS verify:phase4
PASS verify:phase5
PASS verify:phase6
PASS verify:phase6.5
PASS verify:phase7
PASS verify:phase8
PASS verify:phase9
PASS verify:phase10
PASS verify:phases-9-15
PASS verify:paper-blocks
PASS verify:ai-command
PASS verify:auto-trade-clarity
PASS verify:universe
PASS verify:risk-engine
PASS verify:brackets
PASS verify:auto-trade-risk
PASS verify:paper-soak
PASS verify:runtime-settings
PASS verify:auto-trade-controls
PASS verify:auto-trade-modals
PASS verify:small-account
```

| Check | Result |
|-------|--------|
| `npm run build` | **PASS** |
| `npm run lint` | **PASS** |
| `npx tsc --noEmit` | **PASS** |
| `npm test` | **N/A** — no `test` script in `package.json` (verify scripts are the suite) |

### AAPL / open exposure inspection (read-only)

Inspected live Alpaca **paper** account via `scripts/inspect-paper-positions.ts` on 2026-07-15.  
**Nothing was closed, canceled, or modified.**

| Item | Observed |
|------|----------|
| Account | `ACTIVE`, equity ≈ `$99,990` |
| Open position | **AAPL short** `qty = -2`, avg entry ≈ `$318.21`, mark ≈ `$327.57`, unrealized ≈ `-$18.71` |
| Open orders | **None** |
| Local reconcile file | Stale (2026-07-11) still recorded an old long orphan (~2.16 shares) |

#### Proposed operator actions (not executed)

**Do not auto-close.** Choose deliberately:

1. **Monitor** — leave the short open and watch P/L (note: Version 1 is long-only; this short is outside V1 strategy).
2. **Protect externally** — add stop/cover protection in the Alpaca paper UI if keeping the short.
3. **Flatten deliberately** — use in-app **Close All Positions** with typed confirmation when ready to exit.

Recommend flattening or covering before enabling Version 1 auto BUY flow so reconcile / long-only assumptions stay clean.

### Emergency Stop vs Close All (confirmed)

| Action | Behavior | Evidence |
|--------|----------|----------|
| **Emergency Stop** | Panic + disable execution/auto + cancel pending orders; **preserves open positions** | `activateEmergencyStop` does **not** call `closeAllPositions(` |
| **Close All Positions** | Separate deliberate flatten; requires `confirm: true` | `close-all/route.ts` + UI modal |

UI banner explicitly states Emergency Stop does not close unprotected positions.

### Known limitations

- Unprotected banner depends on reconcile `orphanedPositions`; restart the app / monitor to refresh stale local reconcile vs live broker state.
- Existing short AAPL is outside the planned long-only V1 strategy.
- Mega-cap watchlist still yields **0** universe-eligible symbols (blocks V1-2 work next).
- No Jest/`npm test` harness — custom verify scripts only.

### Safety impact

- **Positive:** Clearer unprotected-position warning; tests now enforce Emergency Stop ≠ Close All.
- **Unchanged:** Paper-only hard block; execution/auto remain off by default.
- **No live trading** enabled.

### Completion status

**V1-1 COMPLETE**

---

## Milestone V1-2 — Create a usable Version 1 watchlist

### Objective

Replace the incompatible mega-cap watchlist with a small, liquid, established U.S. stock list that works with existing Version 1 universe filters (≈$5–$50, ADV, spread, no leveraged/inverse ETFs), with clear eligible/ineligible reporting. Keep auto-trading blocked when eligible count is zero. Do not enable execution or auto-trading.

### Previous watchlist problem

Default/`WATCHLIST` used **AAPL, MSFT, GOOGL, AMZN, NVDA**. Under `minPrice=5` / `maxPrice=50`, **all five were rejected by price**, yielding **eligible count = 0** and blocking scans (no silent fallback).

### Candidate symbols considered

- Legacy mega-caps (rejected: above $50)
- Paper-soak list (kept as separate soak profile; includes more speculative names — not used as V1 default)
- Regional banks / midstream with weak **IEX** ADV (KEY, RF, ET, KMI, …) — often fail volume on IEX feed
- Live probes of utilities, airlines, hardware, energy services during RTH

### Final default symbols selected (16)

`F, T, VZ, PFE, WBD, NOK, AAL, CMCSA, HPE, RIG, HBAN, CCL, ITUB, VALE, ERIC, HPQ`

**Single source of truth:** `src/lib/universe/v1-default-watchlist.ts` → `V1_DEFAULT_WATCHLIST`  
Paper-soak list remains in `paper-soak-watchlist.ts` (opt-in profile only).

### Live Alpaca inspection (2026-07-15)

| Field | Value |
|-------|--------|
| Session | **Regular market hours (open)** · Wed 2026-07-15 ~15:30 ET |
| Data | Real Alpaca paper trading + IEX market data |
| Mutations | **None** (no orders/positions touched; AAPL short untouched) |
| Report | `data/v1-watchlist-report.json` via `npm run inspect:v1-watchlist` |

**Eligible (10):** F, T, VZ, PFE, WBD, NOK, AAL, CMCSA, HPE, RIG  

**Ineligible (6) — IEX ADV below 1M (filters unchanged):**

| Symbol | Reason |
|--------|--------|
| HBAN | Trading volume is too low |
| CCL | Trading volume is too low |
| ITUB | Trading volume is too low |
| VALE | Trading volume is too low |
| ERIC | Trading volume is too low |
| HPQ | Trading volume is too low |

Rejected candidates from earlier iterations (not in final default): BAC, INTC, MO, GM (price above Version 1 range); KEY/RF/ET/KMI (chronic low IEX ADV).

### $5–$50 price filter review (documented, not changed)

| Question | Assessment |
|----------|------------|
| Appropriate for small starting account? | **Yes** — keeps notionals/fractional sizing manageable |
| Causes unnecessary rejection of established names? | **Sometimes** — e.g. BAC/INTC/MO/GM are established but above $50 today |
| Remain fixed for V1? | **Yes** — do not widen band to force eligibility |
| Operator-configurable later? | **Recommended** (already partially via runtime `minPrice`/`maxPrice`) — no change in V1-2 |

Also fixed a real ADV accuracy issue: exclude incomplete current 1Day bar during RTH; batch Alpaca bar requests (chunks of 10) so large lists do not return empty volumes.

### Existing code reused

- `src/lib/universe/filters.ts`, `service.ts`, `leveraged-etfs.ts`, `paper-soak-watchlist.ts`
- `resolveEligibleUniverse` / scanner empty-universe block
- Runtime settings watchlist + Auto Trade universe panel

### Files changed

| File | Change |
|------|--------|
| `src/lib/universe/v1-default-watchlist.ts` | **New** — V1 default source of truth |
| `src/lib/universe/user-reasons.ts` | **New** — simple operator rejection copy |
| `src/lib/universe/service.ts` | Richer snapshot, freshness, batching, incomplete-bar ADV fix |
| `src/lib/universe/filters.ts` | Fractionable + metadata failure reasons |
| `src/lib/config.ts` | Default to V1; migrate mega-cap → V1 |
| `src/lib/auto-trade/runtime-settings/defaults.ts` | Seed V1 watchlist |
| `src/lib/auto-trade/runtime-settings/service.ts` | Watchlist source labels; soak ↔ V1 swap |
| `src/lib/auto-trade/status.ts` / `types.ts` | Expose per-symbol universe status |
| `src/components/auto-trade/AutoTradePageView.tsx` | Simple universe table (eligible/ineligible/reasons) |
| `src/lib/client/ui-settings.ts`, `settings/view.ts`, `BacktestView.tsx` | V1 defaults |
| `.env.example`, `.env.local` | `WATCHLIST` → V1 list |
| `data/auto-trade-settings.json` | V1 watchlist; soak/execution/auto **off** |
| `scripts/inspect-v1-watchlist.ts` | Live read-only validator |
| `scripts/verify-universe.ts`, `verify-phase2.ts` | V1 expectations + coverage |
| `package.json` | `inspect:v1-watchlist` script |

### Tests added or updated

- Expanded `verify:universe` for V1 load, duplicates, ETF/penny/volume/spread/stale/metadata/fractionable, zero-eligible block, no mutations, paper safety
- Updated `verify:phase2` empty-watchlist default from AAPL → V1 (`F`)

### Exact test results (2026-07-15)

**All 27 verify scripts: PASS**  
`npm run build` **PASS** · `npm run lint` **PASS** · `npx tsc --noEmit` **PASS**  
`npm run inspect:v1-watchlist` **PASS** (10 eligible during RTH)

### Known limitations

- Volume filter uses **IEX** bars (not full SIP) — some liquid SIP names fail ADV on IEX
- 6 backup names stay on the list for diversification but are often ineligible until IEX ADV clears 1M
- Eligibility fluctuates with price/volume; always re-validated each scan
- After-hours spreads are worse than RTH (UI warns when market closed)
- Existing AAPL paper short was **not** modified

### Safety impact

- **Positive:** Usable eligible universe (≥5 soft minimum met with 10 eligible)
- **Unchanged:** Paper-only; execution/auto remain off; filters not weakened; zero-eligible still blocks trading
- **No live trading**

### Completion status

**V1-2 COMPLETE**

---

## Milestone V1-3 — Simple Version 1 entry strategy

### Objective

Implement one understandable, deterministic, long-only technical entry strategy that evaluates eligible watchlist symbols and produces **BUY / WATCH / SKIP / HOLD**. Suggested entry/SL/TP are planning outputs only. No orders submitted. No positions modified.

### Strategy ID and version

- **Strategy ID:** `v1-simple-long`
- **Strategy version:** `1.0.0`

### Timeframes

| Role | Timeframe | Bars required | Notes |
|------|-----------|---------------|--------|
| Entry setup | **5Min** | ≥22 bars | SMA(8) / SMA(21); short-term trend & volume |
| Trend confirm | **15Min** | ≥13 bars | SMA(5) / SMA(12); must not contradict long |

**Missing bars:** `market_data_bars_sufficient` fails → **SKIP**.  
**Incomplete current bar:** reused existing bar fetch (incomplete current day bar excluded for ADV in universe; strategy uses returned multi-timeframe bars as-is).  
**After-hours / closed:** not treated as equivalent to RTH — timing blocks force SKIP when market is closed.

### Final strategy rules

**Trend (5Min entry + 15Min confirm)**

- Fast SMA above slow SMA on 5Min
- Price above both 5Min MAs
- Fast MA not strongly declining
- 15Min fast≥slow **or** 15Min trend ≥ 0

**Momentum**

- 5Min trendPct ≥ +0.15%
- 5Min trendPct ≤ +3.0% (reject chase / vertical spike)

**Volume**

- Recent/earlier volume ratio ≥ 1.0 (mandatory)
- Ratio ≥ 1.4 optional quality bonus

**Liquidity / spread / freshness**

- Universe-eligible; price in $5–$50
- Spread ≤ configured max (default 0.5%)
- Quote not stale while session open
- Quote/price available; enough bars

**Volatility**

- Primary rangePct between 0.4% and 4.0%
- Outside band → hard **SKIP**

**Timing**

- Regular market open
- Opening delay satisfied
- End-of-day entry cutoff respected (no EOD liquidation in V1-3)

**Position / order conflicts**

- No open position, pending entry, or reconcile uncertainty → else **SKIP**

### Decision definitions

| Label | Meaning |
|-------|---------|
| **BUY** | All mandatory conditions pass and score ≥ buy threshold — executable *candidate* only (not submitted in V1-3) |
| **WATCH** | Safe/eligible; setup promising; one+ non-hard technical conditions incomplete — may become BUY later |
| **SKIP** | Blocked this scan (stale data, timing, conflict, unsafe vol, universe, etc.) |
| **HOLD** | Neutral — no valid new long; not a strong WATCH and not a specific hard block |

### Scoring and thresholds

Single config: `src/lib/strategy/v1-simple-long/config.ts`

- **BUY threshold:** 0.72  
- **WATCH threshold:** 0.55  
- Weights (named): trendAlignment 0.22, priceAboveMas 0.14, trendConfirm 0.14, momentum 0.14, volume 0.14, volatility 0.10, spreadQuality 0.08, vwap 0.04  
- Score is deterministic; **mandatory failures cannot be overridden by a high score**  
- LLM may only attach plain-English explanation after the fact; on LLM failure, local fallback explanation is used

### Mandatory vs optional conditions

**Mandatory categories / IDs (representative):**  
`safety_long_only`, `market_data_*`, `universe_*`, `timing_*`, `position_*`, `volatility_suitable`, `trend_*`, `momentum_*`, `volume_confirmation`

**Optional:** `volume_strong`, `vwap_supportive`

Hard-block categories (force SKIP): safety, market_data, universe, timing, position_state, volatility.  
Failed trend/momentum/volume without hard blocks → WATCH (if score ≥ watch) or HOLD.

### Differences from original suggestion

- Prior engine had **no SMA** — V1-3 added `simpleMovingAverage` / `computeMaAlignment` in `technicals.ts`
- News weight not used for entries (informational only)
- Suggested SL/TP use configured risk percents (default 1.5% / 3%) — planning only
- Scanner only evaluates **universe-eligible** symbols (ineligible never scored as candidates)
- Day with zero BUY signals is acceptable

### Existing code reused

- `analyzeStockTechnicals`, volume ratio, rangePct, VWAP (`technicals.ts`)
- Universe eligibility + risk trading config (price/spread/timing defaults)
- Scanner / decision plumbing; paper-only safety (`assertPaperTradingOnly`)
- Ranking refined so only BUY enters executable-candidate list

### Files changed (V1-3)

| File | Change |
|------|--------|
| `src/lib/strategy/v1-simple-long/*` | **New** package — config, evaluate, explain, rank, log, map, timing, types |
| `src/lib/stocks/technicals.ts` | SMA helpers for MA alignment |
| `src/lib/ai/decision.ts` | `decideForSymbol` uses v1-simple-long |
| `src/lib/monitor/scanner.ts` | Passes position/order/reconcile context; persists V1 snapshot |
| `src/lib/trading/build-candidates.ts` | Qualifies only `decisionLabel === "BUY"` |
| `src/lib/strategy/version.ts` | Name `v1-simple-long`, version default `v1.0.0` |
| `src/app/api/auto-trade/v1-strategy/route.ts` | Read-only latest decisions API |
| `src/components/auto-trade/V1StrategyDecisionsPanel.tsx` | Expandable decision table on Auto Trade |
| `scripts/verify-v1-strategy.ts` + fixtures | 30 fixture-based checks |
| `scripts/inspect-v1-strategy.ts` | Live read-only inspection |
| `scripts/verify-phase2.5.ts` | Accept V1 spread wording |
| `package.json` | `verify:v1-strategy`, `inspect:v1-strategy` |

### Tests added or updated

`npm run verify:v1-strategy` covers: config source; ID/version; BUY/WATCH/HOLD/SKIP fixtures; stale/missing quote; wide spread; low liquidity/volume; price range; trend/momentum/volume/vol; market closed; open delay; EOD cutoff; position/pending/reconcile conflicts; score cannot override mandatory fail; LLM cannot change decision; SL/TP/R:R; ranking; no order submit; paper-only.

### Exact verification results (2026-07-15, after hours)

**All 27 verify scripts: PASS**  
`npm run build` **PASS** · `npm run lint` **PASS** · `npx tsc --noEmit` **PASS**  
There is **no** `npm test` script in this package.

`npm run inspect:v1-strategy` **PASS** (read-only)

### Live read-only inspection results

- **Session context:** after-hours (market CLOSED) — not equivalent to RTH
- **Eligible symbols evaluated:** 1/16 (IEX ADV/session; NOK)
- **Counts:** BUY **0** · WATCH **0** · SKIP **1** · HOLD **0**
- **Example:** NOK → SKIP — “Market is closed — new entries are blocked.”
- **AAPL short** qty=-2 left untouched
- **Orders / positions modified:** none
- Report saved: `data/v1-strategy-report.json`
- Zero BUY after hours is expected and acceptable

### Example decision explanations

- **BUY (fixture):** Strong MA alignment, positive non-spike momentum, confirmed volume, suitable volatility, all safety/timing clear.
- **WATCH (fixture):** Trend OK but volume confirmation weak — promising, not ready.
- **HOLD (fixture):** Neutral chop; no hard block; score below watch threshold.
- **SKIP (live after-hours):** Market closed blocks new entries.

### Known limitations

- Live after-hours inspection understates RTH BUY/WATCH opportunity
- IEX-only data; eligibility and spreads differ from SIP
- Suggested SL/TP are percent-based planning levels, not volatility-ATR adaptive
- No automatic execution (V1-4)
- Existing AAPL short remains outside long-only V1 scope

### Safety impact

- **Positive:** Explicit mandatory conditions; conflicts and stale data block BUY; LLM cannot mutate decisions
- **Unchanged:** Paper-only; execution/auto remain off; universe filters not weakened; AAPL short untouched
- **No live trading; no orders submitted in V1-3**

### Completion status

**V1-3 COMPLETE**

---

## Milestone V1-4 — Complete automated BUY and SELL flow

### Objective

Complete the paper-only round-trip lifecycle: BUY → risk approval → bracket entry → fill → protection verify → monitor → TP/SL/max-hold/EOD/safety exit → exit fill → realized P/L → COMPLETED. Lifecycle correctness and safety only — not profitability.

### Lifecycle architecture

New package `src/lib/trading/v1-lifecycle/`:

- Explicit state machine with illegal-transition rejection
- Persistent trade store (`data/v1-lifecycle-trades.json` + history jsonl)
- Ownership classification (never auto-adopts unknown/legacy)
- Broker sync (accepted ≠ filled; child TP/SL completes)
- Gated entry/exit (execution + Auto Trading must both be ON to mutate)
- Scanner hook syncs every scan; submits timed/EOD exits only when gated on

### Lifecycle states

`CANDIDATE_SELECTED` → `ENTRY_PENDING` → `ENTRY_ACCEPTED` → `ENTRY_PARTIALLY_FILLED` / `ENTRY_FILLED` → `PROTECTION_PENDING` → `POSITION_OPEN` → `EXIT_PENDING` → `EXIT_ACCEPTED` → `EXIT_PARTIALLY_FILLED` / `EXIT_FILLED` → `COMPLETED`

Also: `ENTRY_REJECTED`, `ENTRY_CANCELED`, `EXIT_REJECTED`, `EXIT_CANCELED`, `RECONCILIATION_REQUIRED`, `MANUAL_INTERVENTION_REQUIRED`

Every transition is timestamped with a reason. COMPLETED requires zero remaining qty + exit fill confirmation.

### Ownership model

| Class | Meaning | Auto-managed? |
|-------|---------|---------------|
| `v1_managed` | Local trade record + V1 `client_order_id` | Yes |
| `legacy` | Pre-existing (incl. AAPL short) | **Never** |
| `external` | Broker position, not V1 | No |
| `orphaned` | Open without protection | No (warn) |
| `unknown` | V1 client id without local match | No — pause recommended |

### Entry workflow

BUY-qualified → risk engine → `selectV1EntryCandidate` → `submitV1BracketEntry` with stable `client_order_id` → Alpaca paper bracket (BUY + TP + SL). Idempotent retry adopts existing broker order by client id; ambiguous responses → `RECONCILIATION_REQUIRED` (no blind resubmit). Full gate checklist in `evaluateV1EntryGates`.

### Fill handling / protection

Accepted ≠ filled. Partial fills tracked; protection verified only after full entry fill. Missing protection → `MANUAL_INTERVENTION_REQUIRED` + pause new entries. Never abandon partial fills.

### Monitoring and exit triggers

| Exit | How |
|------|-----|
| TAKE_PROFIT_FILLED / STOP_LOSS_FILLED | Broker bracket children |
| MAX_HOLD_TIME | Market sell remaining V1 long qty |
| END_OF_DAY_EXIT | Market sell remaining V1 long qty |
| STRATEGY_SAFETY_EXIT | Simple gated path when needed |
| Others | Operator / broker / reconcile correction |

Race guard: skip manual/timed exit if sell child already pending/recently filled.

### Maximum holding-time default

**90 minutes** after entry fill — conservative intraday default, not tuned for three trades/day.

### EOD exit timing

**Begin flatten when ≤ 15 minutes remain before regular close** (`eodFlattenMinutes: 15`). Separate from entry cutoff (typically longer). Only V1-managed longs; never AAPL short / external. New entries paused in flatten window.

### Partial-fill and race handling

- Partial entry: remain open; do not second-enter
- Partial exit: remain open until remaining = 0
- Exit qty capped to `min(remaining, broker long qty)` — never short
- Child fill vs timed/EOD: refresh + skip if exit already in flight

### Idempotency

Stable `client_order_id` = `v1_{tradeId}_{leg}` (≤48 chars). Retries look up by client id before placing.

### Reconciliation

`reconcileV1Lifecycle({ dryRun })` syncs local trades from broker truth, classifies positions, never auto-adopts unknown as V1-managed. Inspect command always dry-run.

### Persistence

`data/v1-lifecycle-trades.json` (atomic temp+rename) + `data/v1-lifecycle-history.jsonl` for COMPLETED. No database in V1-4.

### Existing code reused

Bracket builder, risk engine, `submitRiskApprovedEntry`, reconcile orphans, Emergency Stop ≠ Close All, paper-only Alpaca client, scanner loop.

### Files changed (V1-4)

| Area | Files |
|------|--------|
| Lifecycle package | `src/lib/trading/v1-lifecycle/*` |
| Alpaca / brackets | `client.ts` (`client_order_id`, `findOrderByClientOrderId`), `brackets.ts` |
| Submit / auto / scan | `submit-approved.ts`, `auto-trade/service.ts`, `monitor/scanner.ts` → `scan-hook.ts` |
| API / UI | `api/auto-trade/v1-lifecycle/route.ts`, `V1LifecyclePanel.tsx` |
| Verify / inspect | `verify-v1-lifecycle.ts`, fixtures, `inspect-v1-lifecycle.ts`, `package.json` |

### Tests added or updated

`npm run verify:v1-lifecycle` — 40+ deterministic mock cases (candidate, gates, bracket SL/TP/client id, idempotency, accepted≠filled, partial/full fills, reject/cancel/timeout, protection, AAPL short block, no short creation, TP/SL complete, max-hold/EOD qty, races, partial exit, COMPLETED P/L, ambiguous reconcile, restart restore, illegal transitions, Emergency≠CloseAll, no live mutation).

### Exact verification results (2026-07-16)

**All 28 verify scripts: PASS** (27 prior + `verify:v1-lifecycle`)  
`npm run build` **PASS** · `npm run lint` **PASS** · `npx tsc --noEmit` **PASS**  
There is **no** `npm test` script in this package.

`npm run inspect:v1-lifecycle` **PASS** (read-only dry-run)

### Read-only lifecycle inspection results

- **Session:** after-hours (market CLOSED)
- **Positions:** AAPL qty=-2 classified **legacy** — blocks V1 AAPL BUY; **not** auto-modified
- **V1 active trades:** none
- **Missing protection:** none
- **Mutations:** none (orders submitted/canceled/positions modified = 0)
- Report: `data/v1-lifecycle-report.json`

### Existing AAPL short — effect on V1-4 testing

1. Classified `legacy` / `isLegacyAaplShort`
2. Blocks Version 1 AAPL BUY
3. Never counted as a V1 trade
4. Never auto-closed, covered, or protected by V1
5. Does not by itself force global Auto Trading pause (unknown V1 client-id conflicts do)
6. Live end-to-end V1 round-trip was **not** proven against the broker in this milestone (execution/auto remain OFF; verify uses mocks)

### Known limitations

- End-to-end paper fill cycle not live-proven (flags OFF; no smoke order without separate approval)
- After-hours inspection ≠ RTH validation
- Max-hold/EOD exits require execution+auto ON to submit
- Daily 3-trade target tracking deferred to V1-5
- File store only (DB later if needed)

### Safety impact

- **Positive:** Ownership walls; AAPL short untouched; accepted≠filled; missing protection pauses entries; idempotent client ids; Emergency Stop still ≠ Close All
- **Unchanged:** Paper-only; execution/auto OFF by default; live trading hard-blocked
- **No live paper orders submitted during V1-4 verification**

### Completion status

**V1-4 COMPLETE**

---

## Milestone V1-5 — Daily three-trade target

### Objective

Reliable daily tracking of completed Version 1 paper round trips toward a default target of **3** per U.S. trading day. Progress target only — never forces trades or weakens safety.

### Definition of a counted completed trade

All must be true:

- `ownership === v1_managed`
- `lifecycleState === COMPLETED`
- entry filled qty > 0
- exit filled qty ≥ entry filled qty
- remaining qty = 0
- entry + exit fill timestamps present
- realized net or gross P/L recorded

**Not counted:** AAPL short, legacy/external/orphaned/unknown, rejected/canceled/accepted-unfilled, open positions, partial exits.

### Trading-day and timezone rule

- Timezone: **America/New_York**
- Session id: `YYYY-MM-DD` via `marketDayKey`
- **Accounting:** count on the ET market date of the **final exit fill** (when P/L is realized)
- Weekends/holidays/early closes use the ET calendar date; market-clock metadata is separate

### Deduplication

Primary key: **tradeId**. Replays, restarts, and rebuilds ignore duplicates.

### Target vs maximum trades

| Counter | Meaning |
|---------|---------|
| `dailyCompletedTradeTarget` (default 3) | Desired completed round trips |
| `maxTradesPerDay` | Hard cap on **entry submissions** (`paper-trade-log`) |
| `entryAttemptsToday` | Submissions today |
| `filledEntriesToday` | V1 fills (open or done) |
| `completedTradesToday` | Counted round trips |

Target reached does **not** auto-stop trading. Max trades / risk / safety remain authoritative. If `maxTradesPerDay < target`, a configuration warning is shown.

### Daily metrics

Completed/remaining/targetReached, wins/losses/breakeven, gross/net P/L, fees (when known), averages, largest win/loss, consecutive W/L, open/pending, entry attempts, pause flags, failure reasons, config warnings.

### Win/loss classification

Central `classifyRealizedPnL`: prefer net, else gross; breakeven within ±$0.005.

### Target failure reasons

Structured codes (e.g. `NO_QUALIFIED_SETUP`, `EXECUTION_DISABLED`, `POSITION_STILL_OPEN`, …) with operator wording. Multiple reasons allowed.

### Session persistence and rebuild

- Files: `data/v1-daily-sessions/YYYY-MM-DD.json` + `data/v1-daily-latest.json` (atomic write)
- Prior dates never overwritten by a new day
- `rebuildV1DailySession` reconstructs from lifecycle records
- Finalization: explicit or when a later market date starts and no open V1 trades remain; late corrections via rebuild + audit

### API / UI

- `GET /api/auto-trade/daily-status`
- `GET /api/auto-trade/daily-sessions`
- `GET /api/auto-trade/daily-sessions/[date]` (validates YYYY-MM-DD)
- Auto Trade: **Daily progress** panel (“Daily goal: X of 3 completed trades”)

### Existing code reused

`marketDayKey`, lifecycle COMPLETED edge in monitor, `countDailyPaperTrades` for entry attempts, ownership classifier, paper-only safety.

### Files changed (V1-5)

| Area | Files |
|------|--------|
| Package | `src/lib/trading/v1-daily/*` |
| Hook | `v1-lifecycle/monitor.ts` → `recordV1CompletedTrade` |
| API | `daily-status`, `daily-sessions`, `daily-sessions/[date]` |
| UI | `V1DailyProgressPanel.tsx` on Auto Trade |
| Scripts | `verify-v1-daily.ts`, fixtures, `inspect:v1-daily-status`, `package.json` |

### Tests

`npm run verify:v1-daily` — target default, ET day, counting rules, exclusions, dedup, P/L, rebuild, gates not weakened, config warning, failure reasons, persistence, API validation, paper-only.

### Exact verification results (2026-07-16)

**All 29 verify scripts: PASS**  
`npm run build` **PASS** · `npm run lint` **PASS** · `npx tsc --noEmit` **PASS**  
There is **no** `npm test` script in this package.

`npm run inspect:v1-daily-status` **PASS**

### Read-only daily-status inspection

- Session: after-hours · trading date **2026-07-16**
- Completed: **0** · Remaining: **3** · Target reached: no
- AAPL short qty=-2 **legacy — excluded**
- Mutations: none

### Known limitations

- No live completed V1 round trips yet (execution/auto OFF)
- Three-trade goal not operationally proven from fixtures
- Target reached does not auto-disable trading (future optional setting)
- Holiday calendar beyond ET date + Alpaca clock not separately modeled

### Safety impact

- **Positive:** Incomplete target never overrides safety; AAPL short excluded; idempotent counting
- **Unchanged:** Paper-only; execution/auto OFF by default

### Completion status

**V1-5 COMPLETE**

---

## Milestone V1-6 — Simplify the Auto Trade screen

### Objective

Redesign Auto Trade into a simple Version 1 operator dashboard that answers readiness, Auto Trading / paper execution state, market and Alpaca connectivity, daily progress, active managed trade, latest strategy decision, blockers, and safe stop controls — without exposing backend implementation details on the primary surface.

### Previous UI problems

- Dense single-column control-room layout mixing diagnostics with operator actions
- Repeated status (engine pills, paper-test tables, raw candidate/order dumps)
- Legacy AAPL short not visually separated from Version 1 managed trades
- Emergency Stop and Close All mixed with ordinary toggles
- Advanced lifecycle/strategy panels always expanded
- Environment / developer terminology risk on the main page

### Final page structure

1. System status header  
2. Daily progress + Why trading is not active (2-column on desktop)  
3. Current managed trade + Latest strategy decision (2-column)  
4. Legacy / external positions warning (when present)  
5. Main controls + Safety Actions (destructive separated)  
6. Watchlist status + Recent activity (2-column)  
7. Advanced details (collapsed by default)

### Primary visible information

- Paper Trading · Auto Trading On/Off · Order Execution On/Off · Market Open/Closed · Alpaca Connected/Disconnected · Data Current/Stale/After hours/Unavailable  
- Strategy `v1-simple-long` / `1.0.0` · last system update (America/New_York via `formatTime`)  
- Daily goal X of 3, remaining-to-goal wording, wins/losses/breakeven, realized P/L, open/pending counts, progress bar, safety explanation  
- Active Version 1 managed trade (or empty waiting state) with protection / hold / SL / TP  
- Latest BUY/WATCH/SKIP/HOLD decision with expandable condition details  
- Aggregated plain-language blockers  
- Compact universe eligibility + recent activity (≤8 items) with Logs link

### Controls retained

- Auto Trading On/Off (confirmation to enable)  
- Paper Execution On/Off (confirmation to enable)  
- Run Scan Now  
- Pause / Resume New Entries  
- Clear Kill Switch / Clear Emergency Stop (when active)  
- Trading Settings drawer  
- Emergency Stop · Close All Positions (Safety Actions)

### Controls moved to advanced areas

- Paper Test Results, Top candidates, broker open positions / pending orders tables  
- Full recent decisions table, raw log stream snippet  
- Full `V1StrategyDecisionsPanel` and `V1LifecyclePanel`  
- Reconciliation / streak / orphan diagnostic detail

### Safety-action design

- Dedicated `SafetyActionsCard` with red-tinted border, visually below main controls  
- Emergency Stop confirms and states it does **not** close open positions  
- Close All requires typed `CLOSE ALL` and lists affected symbols  
- No destructive buttons beside Run Scan

### Legacy-position presentation

- `ExternalPositionsWarning` shows AAPL short as Legacy / external  
- States Version 1 will not manage/close it and AAPL entries are blocked  
- Link to `/trade` for deliberate position management — no auto-close button in the warning

### Mobile behavior

- Cards stack cleanly; Playwright checks at 390 / 834 / 1440px: no primary horizontal overflow  
- Buttons use `min-h-11` tap targets; dense tables sit behind expand controls

### Accessibility improvements

- Info tips with `aria-label="More information"`  
- Progress bar `aria-valuetext`  
- Status not color-only (text labels on pills/decisions)  
- Confirm modals retain focus trap / Escape / typed confirm  
- Icon/info controls labeled; tables in expandable sections have headings

### Existing code reused

- `/api/auto-trade`, `/api/auto-trade/daily-status`, `/api/auto-trade/v1-lifecycle`, `/api/auto-trade/v1-strategy`  
- `AutoTradeControlsPanel` enable modals + settings drawer  
- `UnprotectedPositionsBanner`, `SafetyBanner`, `ConfirmActionModal`  
- V1 strategy / daily / lifecycle backend unchanged (presentation + `alpacaConnected` flag only)

### Components created or changed

**Created:** `AutoTradeStatusHeader`, `TradingBlockersPanel`, `V1ManagedTradeCard`, `ExternalPositionsWarning`, `LatestStrategyDecisionCard`, `V1UniversePanel`, `RecentAutoTradeActivity`, `AdvancedAutoTradeDetails`, `SafetyActionsCard`, `AutoTradeInfoTip`, `operator-blockers.ts`  

**Changed:** `AutoTradePageView`, `AutoTradeControlsPanel`, `V1DailyProgressPanel`, `status.ts` / `types.ts` (`alpacaConnected`)

### Files changed

- `src/components/auto-trade/*` (page + new panels)  
- `src/lib/auto-trade/operator-blockers.ts`, `status.ts`, `types.ts`  
- `scripts/verify-v1-auto-trade-ui.ts` + updates to clarity/controls/modals/risk/universe/paper-soak/runtime-settings verifies  
- `package.json` (`verify:v1-auto-trade-ui`)  
- this plan document

### Tests added or updated

- **Added:** `npm run verify:v1-auto-trade-ui` — fixture/source checks for the 50+ UI requirements (no live/paper order submission)  
- **Updated:** auto-trade clarity/controls/modals/risk, universe, paper-soak, runtime-settings verifies for new component split  
- **Note:** There is still **no** `npm test` script in `package.json`

### Complete verification results

All `npm run verify:*` scripts **PASS** (including new `verify:v1-auto-trade-ui`).

### Build, lint, and TypeScript results

- `npm run build` — PASS  
- `npm run lint` — PASS  
- `npx tsc --noEmit` — PASS  

### Visual inspection results

Local production server inspected with Playwright (read-only; execution/auto left OFF; no orders):

| Width | Result |
|-------|--------|
| Desktop 1440 | All primary labels present; no horizontal overflow |
| Tablet 834 | Same |
| Mobile 390 | Same; stacked cards |

Observed live state during inspection: Market Closed · Alpaca Connected · Auto/Execution Off · 0/3 daily · no V1 managed trade · AAPL short legacy warning · 0 eligible (after-hours) · Advanced collapsed.

### Known limitations

- After-hours eligible count may be 0 (universe freshness) — expected  
- No live paper round-trip proven yet  
- Strategy decision SL/TP planning values when market is closed may look odd; backend strategy unchanged in V1-6  
- Screenshots kept local under `/tmp/v1-6-auto-trade/` (not committed)

### Safety impact

- No strategy, lifecycle, or daily-target behavior changes  
- Execution and Auto Trading remain OFF by default; not enabled for validation  
- No orders submitted or positions modified  
- Live trading remains hard-blocked  
- Emergency Stop still does not close positions; Close All remains separate with stronger confirm

### Completion status

**V1-6 COMPLETE**

---

## Milestone V1-7 — Expanded Version 1 testing

### Objective

Build a comprehensive deterministic verification layer for the full Version 1 workflow (watchlist → strategy → gates → bracket → lifecycle → exit → daily → UI) before any controlled paper-order smoke test. No live paper execution; no Alpaca mutations in standard verifies.

### Test architecture

- **Approach:** Extended existing custom `tsx` verify scripts (no Jest/Vitest migration).
- **No `npm test` script** — V1 suite is `npm run verify:v1-all` plus existing phase verifies.
- **Isolation:** `TRADINGAI_DATA_DIR` + `getTradingDataDir()` so lifecycle, daily sessions, and runtime settings write to temp dirs during tests.
- **Harness:** `scripts/lib/v1-harness/` — `FakeAlpacaBroker`, `FakeClock`, `withTempTradingData`, scenarios A–J.
- **Fixtures:** Existing `scripts/fixtures/v1-*-fixtures.ts` reused.
- **UI:** Still mostly source + pure-helper checks (no RTL); behavioral helpers preferred where available.
- **Inspect scripts:** Live Alpaca **read-only** after deterministic suite; after-hours ≠ RTH validation.

### Test groups

| # | Group | Command(s) |
|---|-------|------------|
| 1 | Config & paper-only safety | `verify:v1-safety` |
| 2 | Watchlist & universe | `verify:universe` |
| 3 | Strategy decisions | `verify:v1-strategy` |
| 4 | Risk & entry eligibility | `verify:risk-engine` + gates in lifecycle/integration |
| 5 | Order construction & idempotency | `verify:brackets` + `verify:v1-lifecycle` |
| 6–10 | Lifecycle / fills / protection / exits / reconcile | `verify:v1-lifecycle` + integration |
| 11 | Daily target accounting | `verify:v1-daily` |
| 12 | API behavior | `verify:v1-api` |
| 13 | Auto Trade UI | `verify:v1-auto-trade-ui` |
| 14–15 | E2E simulations + failure injection | `verify:v1-integration` |

Aggregate: **`npm run verify:v1-all`**

### Shared harness and fixtures

- `scripts/lib/v1-harness/{temp-data,fake-broker,fake-clock,simulations,index}.ts`
- `src/lib/paths/data-root.ts` — `TRADINGAI_DATA_DIR` override
- Fixtures under `scripts/fixtures/`

### Full-flow simulations

A take-profit win · B stop-loss loss · C partial entry · D max-hold · E EOD (AAPL untouched) · F ambiguity · G restart · H safety vs daily goal · I zero eligible · J legacy AAPL conflict

### Failure-injection coverage

Broker unavailable · illegal transitions · accepted≠filled regression · market-closed not bypassed by 0/3 target · ambiguous place single attempt

### Files changed

- `src/lib/paths/data-root.ts` (new)
- Stores/settings use `getTradingDataDir()` (lifecycle, daily, runtime-settings)
- `src/lib/auto-trade/enable-guards.ts` + enable route wiring
- `scripts/lib/v1-harness/*`, `verify-v1-safety|api|integration|all.ts`
- `package.json` scripts; `.cursor/handoffs/v1-test-matrix.md`; this plan

### Tests added or updated

- **Added:** `verify:v1-safety`, `verify:v1-api`, `verify:v1-integration`, `verify:v1-all`
- **Retained/used:** universe, strategy, lifecycle, daily, auto-trade-ui, risk-engine, brackets
- Existing phase verifies unchanged and still pass

### Defects found

1. Auto Trading enable API did not enforce execution-on / critical-lifecycle (UI-only gates).
2. Deterministic verifies could write into production `data/` (lifecycle/daily/settings).

### Defects fixed

1. `assertCanEnableAutoTrading` + `/api/auto-trade/enable` guard (execution off, critical lifecycle, zero-eligible when snapshot present).
2. Data-root override for lifecycle, daily, and runtime-settings persistence.

### Regression tests

Covered in `verify:v1-api`, `verify:v1-safety`, and temp-data usage in integration.

### Complete verification results

- `npm run verify:v1-all` — **PASS**
- All existing `npm run verify:*` scripts — **PASS**

### Build, lint, and TypeScript results

- `npm run build` — PASS  
- `npm run lint` — PASS  
- `npx tsc --noEmit` — PASS  

### Read-only inspection results (2026-07-16, **market CLOSED / after-hours**)

- Watchlist: 1 eligible (HPQ); after-hours spread warnings — not RTH  
- Strategy: 0 BUY; HPQ SKIP (market closed); AAPL short untouched  
- Lifecycle: AAPL legacy short; no active V1 trades; planned mutations NONE  
- Daily: 0/3 completed; execution/auto OFF; AAPL excluded  
- **Orders submitted/canceled/positions modified: 0**

### Test-data isolation method

Set `TRADINGAI_DATA_DIR` to `os.tmpdir()` via `withTempTradingData()`; cleanup after success; keep labeled temp dir on failure.

### Coverage gaps

- No React Testing Library interaction suite  
- No running Next.js HTTP e2e  
- Some UI asserts remain source-string based  
- Live inspect is session-dependent (after-hours)

### Known limitations

- No real paper round-trip proven  
- After-hours inspect ≠ RTH readiness  
- AAPL short still operator-owned  

### Safety impact

- Stronger Auto Trading enable API guards  
- Safer test isolation (no accidental production `data/` clobber)  
- Execution/Auto remain OFF; no orders/positions modified; live hard-blocked  

### Completion status

**V1-7 COMPLETE**

---

## Milestone V1-8 — Controlled paper smoke test and soak

### Objective

Prove the Version 1 workflow with tiny Alpaca **paper** orders during regular U.S. market hours:

qualified BUY → paper bracket → entry fill → confirmed SL/TP → monitor → exit fill → COMPLETED → realized P/L → daily-session accounting.

Two stages: **Stage A** (one-trade supervised smoke) then **Stage B** (multi-day soak). Never live. Do not enable unattended Auto Trading until Stage A passes and Days 1–5 of soak pass under supervision.

### Stage A preflight (executed this session)

Command: `npm run paper-smoke:v1:preflight`  
Report: `data/v1-soak/preflight-2026-07-16.json`

| Check | Result |
|-------|--------|
| Market open / RTH | **NO** — after-hours (`marketOpen: false`) |
| Alpaca paper connected | YES — `paper-api.alpaca.markets` |
| Paper endpoint OK | YES |
| Data freshness | `after_hours` (not RTH proof) |
| Eligible symbols (excl. AAPL) | 0 this window |
| Strategy decisions | 0 BUY / 0 WATCH / 0 SKIP / 0 HOLD (no eligible scan set) |
| Reconciliation | Healthy |
| Active V1 trades / pending | 0 / 0 |
| Legacy AAPL short | Present qty **-2**, ownership legacy, **untouched**, blocks AAPL BUY |
| Execution | **OFF** |
| Auto Trading | **OFF** |
| Mutations | **0** orders / cancels / position mods |
| Readiness verdict | **`rth_required`** |

Also confirmed: gated `submit` without RTH aborts (`aborted_not_ready`); no order submitted. Report: `data/v1-soak/smoke-result-2026-07-16.json`.

### Smoke-test risk profile (scoped, temporary)

Profile name: `v1-stage-a-supervised-smoke` (`src/lib/trading/v1-smoke/profile.ts`)

- `maxOpenPositions: 1`
- `maxNewEntriesForSmokeTest: 1`
- `maxNotionalUsd: 25`
- `maxRiskPerTradePct: 0.1`
- `maxDailyLossUsd: 2`
- `maxDailyLossPct: 0.5`
- Opening delay 15m / EOD entry cutoff 45m / EOD flatten 15m / max hold 90m
- Auto Trading must remain OFF; typed confirmation `PAPER SMOKE`
- Does **not** permanently change Version 1 defaults

### Operator confirmation design

- CLI: `npm run paper-smoke:v1` modes: `preflight` | `preview` | `submit`
- **Not** wired into `verify:*`, install, build, `dev`, or app/monitor startup
- `submit` requires: RTH readiness, `--symbol` matching preview, `--confirm "PAPER SMOKE"`, `--enable-execution-once`
- Temporarily enables paper execution for that one attempt, then disables it
- Prints full order preview before any mutation path
- Exits without mutation if any gate fails

### Selected symbol and why

**None.** Stage A symbol selection requires RTH + fresh BUY under `v1-simple-long 1.0.0`. After-hours preflight produced no qualified BUY window.

### Order preview / Entry / Fill / Protection / Lifecycle / Exit / Realized / Daily count

**Not executed** — Stage A submission correctly refused (`rth_required`).

### Post-trade reconciliation

N/A (no trade). Post-trade checklist deferred until a supervised RTH round trip completes.

### Stage A pass/fail verdict

**FAIL / incomplete for lifecycle pass** — tooling + after-hours preflight only.  
Safe outcome: no paper order placed outside RTH.  
This is **not** a Stage A lifecycle pass and **does not** start Stage B.

### Stage B soak configuration

Scaffold only: `data/v1-soak/aggregate.json` (`status: not_started`), `data/v1-soak/daily/` ready.  
Soak profile (when Stage A passes): maxOpen 1, maxNewEntriesPerDay ≤ 3, daily target 3 (never forces trades), risk ≤ 0.25% equity, allocation ≤ 5%, daily loss ≤ 1% + dollar cap, consecutive-loss pause ≥ 3, RTH/brackets/long-only, no overnight, no AAPL while legacy short exists. Day 1 = 1 entry max supervised; escalate only after clean days.

### Daily soak reports / Aggregate results

- Daily reports: **0** trading days recorded
- Aggregate: scaffold only — *"Paper results do not prove future profitability."*
- Soak days completed: **0**

### Defects found / fixed / regression tests

| Item | Status |
|------|--------|
| Defects found during live smoke | None (no RTH trade attempted) |
| Tooling added | `src/lib/trading/v1-smoke/*`, `scripts/paper-smoke-v1.ts`, package scripts |
| Regression | `verify:v1-safety` asserts `paper-smoke` is **excluded** from `verify:v1-all` and requires typed confirm flags |

### Known limitations

- Stage A **cannot** pass outside regular U.S. market hours
- After-hours eligibility/spreads are not RTH proof
- No Version 1-managed paper round trip has been proven yet
- Legacy AAPL short remains operator-owned; V1 must not modify it

### Safety impact

- Live trading remains hard-blocked
- Execution / Auto Trading remain **OFF** after preflight
- Smoke submit path cannot run without deliberate confirmations
- AAPL short left untouched; no unrelated mutations

### Operational-readiness verdict

**Not ready** for Stage B or unattended paper operation. Ready only for **repeat RTH preflight → preview → supervised one-trade submit** during the next regular session.

### Completion status

**IN PROGRESS — tooling complete; Stage A paper evidence incomplete**

**Do not mark V1-8 complete** until a supervised paper round trip meets Stage A pass criteria and soak evidence is recorded.

### Verification (this session)

- `npm run verify:v1-all` — **PASS**
- `npx tsc --noEmit` — **PASS**
- Preflight mutations — **0**

---

## Remaining blockers (after V1-8 tooling)

1. Open **AAPL short** on paper (legacy) — operator decision; blocks V1 AAPL BUY; do not auto-modify.
2. **No Version 1 paper round-trip proven** — Stage A still requires RTH supervised smoke.
3. Re-run `npm run paper-smoke:v1:preflight` during RTH; only then consider preview/submit with typed `PAPER SMOKE`.
4. Keep execution and Auto Trading **OFF** except the deliberate smoke `--enable-execution-once` window.
5. Stage B soak must not start until Stage A lifecycle **pass**.

## Recommended next action

During the next **regular U.S. market session**: run `npm run paper-smoke:v1:preflight`. If verdict is `ready_for_operator_preview`, run `preview`, then only with explicit operator intent run `submit --symbol <SYM> --confirm "PAPER SMOKE" --enable-execution-once`. If `safe_no_trade`, record and do not force a trade. Never live; never touch the AAPL short.
