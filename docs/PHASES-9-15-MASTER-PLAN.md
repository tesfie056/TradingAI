# Phases 9–15: Automatic Paper Trading Intelligence

**Rules (all phases):** U.S. stocks only · paper only · no crypto/options/live · AI never bypasses safety · AI analyzes/explains only.

| Phase | Focus | Status |
|-------|--------|--------|
| **9** | Auto-trade stabilization | verify-phase9, kill-switch clarity, exact skip reasons |
| **10** | Faster monitoring | background worker, SSE, caches, market-aware intervals |
| **11** | Stronger decision engine | extended scores, SKIP/WATCH, small-account filters |
| **12** | Smarter AI reasoning | Ollama explanations (read-only, never orders) |
| **13** | Training data loop | signal-training.jsonl, multi-horizon outcomes |
| **14** | Performance analytics | win rate, skip breakdown, confidence vs result |
| **15** | Backtest & strategy versions | versioned config, historical comparison |

## Phase 9 — Stabilization

- `AUTO_PAPER_TRADING_ENABLED` env gate + runtime kill switch
- Exact skip codes in decisions + logs
- Limits: daily trades, cooldown, loss, duplicate symbol, max notional
- UI: `AgentLiveStatus`, rules panel, resume/kill/panic

**Verify:** `npm run verify:phase9`

## Phase 10 — Faster monitoring

- `src/instrumentation.ts` → `ensureMonitorWorkerRunning()`
- Open: `MONITOR_INTERVAL_OPEN_MS` (default 90s)
- Closed: `MONITOR_INTERVAL_CLOSED_MS` (default 15m)
- Quote cache 25s · news cache 5m · parallel Finnhub (3)
- SSE: `/api/monitor/stream` · heartbeat 5s

**Verify:** `npm run verify:phase10`

## Phase 11 — Decision engine

Scores: `technicalScore`, `newsScore`, `marketScore`, `riskScore`, `liquidityScore`, `volumeScore`, `momentumScore`, `finalScore`, `confidence`

Labels: `BUY | SELL | HOLD | WATCH | SKIP`

Small account: $5 default · $10 max · liquid · tight spread · volume · trend

**Module:** `src/lib/stocks/scoring.ts`, `src/lib/strategy/version.ts`

## Phase 12 — AI reasoning

- `src/lib/ai/trade-reasoning.ts` — Ollama explains allow/block/risk/changes
- Never calls order APIs; falls back to heuristic text

## Phase 13 — Training loop

- `data/signal-training.jsonl` — every auto decision + price horizons
- `src/lib/training/signal-loop.ts` — record on skip/place
- Outcomes: m5, m15, h1, close (updated by `updateSignalOutcomes`)

## Phase 14 — Analytics

- `src/lib/performance/auto-trade-analytics.ts`
- Win rate, avg P/L, best/worst symbols, skip breakdown, confidence buckets
- `GET /api/auto-trade/analytics`

## Phase 15 — Backtest & strategy

- `STRATEGY_VERSION` env (default `v1.0.0`)
- `src/lib/strategy/version.ts` — weights + changelog
- Backtest compares strategy version in results (`src/lib/performance/backtest.ts`)

**Verify all:** `npm run verify:phases-9-15`
