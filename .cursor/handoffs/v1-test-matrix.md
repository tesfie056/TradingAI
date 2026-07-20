# Version 1 Test Matrix

**Last run:** 2026-07-16  
**Suite command:** `npm run verify:v1-all`  
**Framework:** Custom `tsx` verifies (no Jest/Vitest/`npm test`)  
**Isolation:** `TRADINGAI_DATA_DIR` temp directories for lifecycle / daily / settings writes  
**Broker:** Deterministic fixtures + `FakeAlpacaBroker` — never mutates live Alpaca in standard verifies  

| Group | Requirement area | Primary script(s) | Deterministic | Broker mutation possible | Status |
|-------|------------------|-------------------|---------------|--------------------------|--------|
| 1 | Config & paper-only safety | `verify:v1-safety` | Yes | No | PASS |
| 2 | Watchlist & universe | `verify:universe` | Yes | No | PASS |
| 3 | Strategy decisions | `verify:v1-strategy` | Yes | No | PASS |
| 4 | Risk & entry eligibility | `verify:risk-engine`, `verify:v1-lifecycle` (gates), `verify:v1-integration` | Yes | No | PASS |
| 5 | Order construction & idempotency | `verify:brackets`, `verify:v1-lifecycle` | Yes | No (injected) | PASS |
| 6 | Lifecycle state machine | `verify:v1-lifecycle`, `verify:v1-integration` | Yes | No | PASS |
| 7 | Entry-fill handling | `verify:v1-lifecycle`, `verify:v1-integration` | Yes | No | PASS |
| 8 | Protection monitoring | `verify:v1-lifecycle` | Yes | No | PASS |
| 9 | Exit handling | `verify:v1-lifecycle`, `verify:v1-integration` A–E | Yes | No | PASS |
| 10 | Reconciliation & restart | `verify:v1-lifecycle`, `verify:v1-integration` F–G | Yes | No | PASS |
| 11 | Daily target accounting | `verify:v1-daily` | Yes | No | PASS |
| 12 | API behavior | `verify:v1-api` | Yes | No* | PASS |
| 13 | Auto Trade UI | `verify:v1-auto-trade-ui` | Yes (source + helpers) | No | PASS |
| 14 | Cross-module E2E simulations A–J | `verify:v1-integration` | Yes | No | PASS |
| 15 | Failure injection & regression | `verify:v1-integration` | Yes | No | PASS |

\*Close All / enable guards tested without successful broker liquidation; confirm rejection short-circuits before broker calls.

## Integration simulations (Group 14)

| Scenario | Expected | Script | Status |
|----------|----------|--------|--------|
| A Take-profit win | COMPLETED, +P/L, daily wins=1 | `scenarioTakeProfitWin` | PASS |
| B Stop-loss loss | COMPLETED, −P/L, daily losses=1 | `scenarioStopLossLoss` | PASS |
| C Partial entry → full exit | No short; countable once | `scenarioPartialEntryFullExit` | PASS |
| D Max-hold 90m | Exit reason MAX_HOLD_TIME | `scenarioMaxHoldExit` | PASS |
| E EOD exit | END_OF_DAY_EXIT; AAPL qty unchanged | `scenarioEodExitLeavesLegacy` | PASS |
| F Broker ambiguity | RECONCILIATION_REQUIRED; one place attempt | `scenarioBrokerAmbiguity` | PASS |
| G Restart recovery | Restored fill; no duplicate place | `scenarioRestartRecovery` | PASS |
| H Safety overrides goal | Blocks despite 0/3 target | `scenarioSafetyOverridesDailyGoal` | PASS |
| I Zero eligible | Universe gate blocks | `scenarioZeroEligibleBlocksAuto` | PASS |
| J Legacy AAPL short | AAPL blocked; other symbol ok | `scenarioLegacyShortConflict` | PASS |

## Architecture notes

- **Existing verifies:** Many behavioral fixture tests already covered Groups 2–11 before V1-7; V1-7 added harness isolation, API guards, E2E simulations, and aggregate `verify:v1-all`.
- **Gaps remaining:** No React Testing Library render suite; UI checks remain largely source + pure helper behavioral. No HTTP server e2e. Inspect scripts are live read-only and session-dependent (after-hours ≠ RTH).
- **Duplicate helpers reduced:** Shared `scripts/lib/v1-harness/` (temp data, fake broker, fake clock, simulations).

## Defects found / fixed in V1-7

| Defect | Fix | Regression |
|--------|-----|------------|
| Auto Trading API could enable while execution OFF / with critical lifecycle | `assertCanEnableAutoTrading` + wire into `/api/auto-trade/enable` | `verify:v1-api`, `verify:v1-safety` |
| Lifecycle/daily/settings tests could write production `data/` | `TRADINGAI_DATA_DIR` via `getTradingDataDir()` | Integration/safety/api temp-data usage |

## Read-only inspection (not part of verify:v1-all)

| Command | Last result (2026-07-16 after-hours) | Mutations |
|---------|--------------------------------------|-----------|
| `inspect:v1-watchlist` | 1 eligible (HPQ); after-hours spread warnings | None |
| `inspect:v1-strategy` | 0 BUY; HPQ SKIP (market closed) | None |
| `inspect:v1-lifecycle` | AAPL short legacy; no active V1 trades | None |
| `inspect:v1-daily-status` | 0/3 completed; execution/auto off | None |
