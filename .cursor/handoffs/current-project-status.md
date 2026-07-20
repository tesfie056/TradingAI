# TradingAI — Current Project Status

**Generated:** 2026-07-15  
**Repo HEAD:** `43c666f` — *Add paper auto-trade controls, runtime settings, and in-app confirm modals.* (2026-07-10)  
**Branch:** `main`  
**Scope of review:** Repository source, docs, verify scripts (executed this session), local `data/` runtime artifacts, `.env.local` flag names/values (secrets redacted). No code changes were made for this review.

**Evidence legend used below**

| Tag | Meaning |
|-----|---------|
| **Code** | Verified by reading/implementing source |
| **Tests** | Verified by running `npm run verify:*` this session |
| **Docs** | Stated in README/docs but not independently proven live |
| **Not implemented** | No code path found |

---

## Executive verdict

This is a **working personal Alpaca paper-trading desk** (Next.js 16 + React 19) with monitor scanning, heuristic AI decisions, manual paper preview/submit, and a full auto-trade path with risk engine + bracket orders. **Live trading is hard-blocked.** Order execution and auto-trading are **off by default** (and currently off in runtime settings / `.env.local`).

README still describes early phases and says execution stays disabled permanently; that is **out of date** relative to Phases 6–15+ in code.

**Honest bottom line:** Core paper desk ~complete; auto-trade machinery built and unit-verified; **not yet soak-validated or safe for continuous auto trading** with the current mega-cap watchlist (universe eligible count = 0). **Live trading readiness = 0%.**

---

## 1. Phase-by-phase progress summary

| Phase | Focus | Status | Evidence |
|-------|--------|--------|----------|
| **1** | Next.js dashboard + Alpaca paper client + safety | **Complete** | **Code** + **Tests** `verify:phase1` PASS |
| **2** | Watchlist + AI decisions + history | **Complete** | **Code** + **Tests** `verify:phase2` PASS |
| **2.5** | Market clock, freshness, wide-spread → HOLD | **Complete** | **Code** + **Tests** `verify:phase2.5` PASS |
| **3** | News abstraction + sentiment nudge | **Complete** | **Code** + **Tests** `verify:phase3` PASS |
| **3.5** | Finnhub provider + mock fallback | **Complete** | **Code** + **Tests** `verify:phase3.5` PASS |
| **4** | Heuristic / Ollama news interpretation | **Complete** | **Code** + **Tests** `verify:phase4` PASS |
| **5** | Outcomes, accuracy, backtest APIs | **Complete** | **Code** + **Tests** `verify:phase5` PASS; 135 local decisions with outcomes |
| **6** | Manual paper preview/submit + gates | **Mostly complete** | **Code** present; **Tests** `verify:phase6` **FAIL** (stale default: expects daily max 5, code default now 3) |
| **6.5** | Control-room / trade UX polish | **Complete** | **Code** + **Tests** `verify:phase6.5` PASS |
| **7** | Monitor worker, opportunities, SSE, no monitor orders | **Complete** | **Code** (`instrumentation.ts`, monitor modules) + **Tests** `verify:phase7` PASS |
| **8** | Auto paper trading module + kill/panic | **Complete (gated off)** | **Code** + **Tests** `verify:phase8` PASS |
| **9** | Auto-trade stabilization / skip codes | **Complete** | **Code** + **Tests** `verify:phase9` PASS; master plan **Docs** |
| **10** | Faster monitoring (caches, intervals, SSE) | **Complete** | **Code** + **Tests** `verify:phase10` PASS |
| **11** | Extended scoring + BUY/SELL/HOLD/WATCH/SKIP | **Complete** | **Code** + **Tests** inside `verify:phases-9-15` PASS |
| **12** | Ollama trade *reasoning* (explain only) | **Complete** | **Code** `trade-reasoning.ts` + **Tests** phases-9-15 PASS |
| **13** | Signal training JSONL loop | **Implemented, unused in runtime** | **Code** + **Tests** structure PASS; **Not** exercised — no `data/signal-training.jsonl` |
| **14** | Auto-trade analytics API | **Complete** | **Code** + **Tests** PASS |
| **15** | Strategy version + results store | **Complete (static weights)** | **Code** `strategy/version.ts` v1.0.0 + **Tests** PASS |
| **H / Soak** | Controlled paper soak checklist | **Documented, not completed** | **Docs** `PAPER-SOAK-TEST-CHECKLIST.md` all unchecked; `PAPER_SOAK_PROFILE` false; verify script PASS (code shape only) |
| **Live trading** | Real-money Alpaca | **Not implemented / blocked** | **Code** hard rejects `api.alpaca.markets` |

Commit arc (verified from `git log`):

1. `6d9d4f7` — Phases 1–5  
2. `68c54fd` — Phases 6–6.5 + control room  
3. `84e6ad2` / `6c34da9` — manual trade UX + snapshot fix  
4. `dcd0698` — Phase 7 monitor + page nav  
5. `2bc3220` — Settings polish  
6. `43c666f` — Auto-trade controls, runtime settings, risk/universe/brackets/soak (large)

---

## 2. Features that are fully completed

**Verified from code + tests**

- Paper-only Alpaca trading client (account, positions, clock, orders, cancel, close, assets, `placePaperOrder` gated)
- Market data REST: latest quotes/bars + historical bars (IEX feed)
- Safety: `assertPaperTradingOnly` / blocked live hosts on every trading fetch
- Watchlist AI decisions (heuristic scoring) with confidence, reasons, risk warnings
- News (mock / Finnhub) with sentiment; cannot override safety HOLDs
- Optional Ollama for news interpretation + trade *explanations* (not order decisions)
- Decision history + multi-horizon outcome tracking + performance API
- Historical backtest simulation (no orders)
- Manual paper trade preview + gated submit + confirmation UX
- Background monitor worker (open ~90s / closed ~15m), opportunities, SSE stream
- Auto-trade eligibility, policy, kill switch, panic, pause/resume, emergency stop
- Risk engine: sizing, max positions, daily loss %, consecutive-loss pause, RTH, open delay, EOD cutoff, long-only, reconcile gate
- Bracket order builder (stop-loss + take-profit) for auto BUY entries
- Universe filters (price, volume, spread, leveraged/inverse ETF denylist, soak watchlist)
- Runtime settings service (persist `data/auto-trade-settings.json`, audit, cannot unlock live)
- Session reporting + reconcile state files
- Full page navigation desk (Dashboard, Monitor, Auto Trade, Watchlist, Trade, etc.)
- In-app confirm modals for dangerous actions (Emergency Stop, Close All, enable toggles)
- AI Assistant popup (task API; never submits orders) — **Tests** `verify:ai-command` PASS

---

## 3. Features that are partially completed

| Feature | What’s done | What’s missing / weak | Evidence |
|---------|-------------|----------------------|----------|
| **Manual paper orders** | Preview/submit path | No brackets/SL/TP on manual path (plain market qty/notional) | **Code** |
| **Auto trading** | Full pipeline coded | Env/runtime off; never soak-proven; mega-cap watchlist → 0 eligible | **Code** + `data/universe-snapshot.json` |
| **Protective orders** | Brackets on new auto BUY | Existing AAPL position flagged unprotected; no auto-attach stops | **Code** + `data/reconcile-state.json` / session report |
| **Training loop** | Writer + outcome updater | No `signal-training.jsonl` yet; no weight learning from it | **Code** + filesystem |
| **Ollama AI** | Wired for news/reasoning | Decisions remain heuristic; Ollama may be down locally | **Code**; `.env.local` `AI_PROVIDER=ollama` |
| **Settings page** | Local prefs + read-only provider status | Does not mutate server env / watchlist | **Code** |
| **Assistant page** | Launcher + copy | Chat lives in shell popup; page itself is thin | **Code** |
| **Daily PnL tracking for auto** | Risk runtime + eligibility $ loss | BUY bracket fills may not update estimated PnL the same as SELLs | **Code** (partial) |
| **README / docs** | Early phases accurate | Omits Phases 6–15; contradicts “execution stays forever off” | **Docs** drift |
| **Verify suite** | 24/27 scripts pass | 3 scripts fail (stale assertions vs UI/defaults) | **Tests** this session |
| **Paper soak (Phase H)** | Checklist + profile + verify shape | Checklist unchecked; soak profile disabled | **Docs** + runtime settings |

---

## 4. Features planned but not started

**Not implemented** (no code)

- Live / real-money trading unlock
- Alpaca WebSocket / streaming market data
- ML model training, fine-tuning, or closed-loop weight updates from training JSONL
- Persistent database (Postgres/SQLite/etc.) — file JSON/JSONL only
- Crypto / options trading
- Trailing stops beyond initial bracket SL/TP
- Portfolio correlation / sector exposure limits
- Auto-repair of orphaned/unprotected positions (detect only)
- SIP market-data feed option (IEX only)

**Documented as future soak work, not executed**

- End-to-end paper soak scenarios in `docs/PAPER-SOAK-TEST-CHECKLIST.md` (all boxes empty)

---

## 5. Current frontend pages and what each page does

| Route | Purpose |
|-------|---------|
| `/` | Redirects to `/dashboard` |
| `/dashboard` | Calm overview: equity/cash/BP, market/AI/execution status, top signal, monitor snapshot, quick links |
| `/watchlist` | Filterable AI decision table (BUY/SELL/HOLD…), row expand, prepare → Trade |
| `/trade` | Manual paper preview/submit desk, gates, blockers, recent orders, small-stock helpers |
| `/monitor` | Start/stop/scan background agent, SSE live status, opportunities, notifications, logs |
| `/auto-trade` | Enable/disable execution & auto, kill/panic/emergency/close-all, universe, decisions/logs, Trading Settings drawer, session/paper test results |
| `/assistant` | Thin launcher that opens floating AI popup |
| `/performance` | Decision accuracy / estimated P/L by symbol/action/confidence |
| `/backtest` | Historical decision replay for a symbol/date range |
| `/settings` | Local UI prefs + read-only safety/provider status |
| `/logs` | Unified view: decisions, blocks, paper orders, monitor logs, AI command history |

**Nav:** StatusBar (inside AppShell) — Dashboard, Monitor, Auto Trade, Watchlist, Trade, Assistant, Performance, Backtest, Settings, Logs.

**Evidence:** **Code** (page files + view components). Unused leftovers: `AiCommandCenter.tsx`, `DashboardSummary.tsx`.

---

## 6. Current backend services, APIs, database, and integrations

### Stack

- **Next.js App Router** API routes under `src/app/api/` (**44** route handlers)
- **No real database** — persistence in `data/*.json` / `*.jsonl` (gitignored)
- **Background:** `src/instrumentation.ts` loads runtime settings + starts monitor worker

### Major API groups (**Code**)

| Group | Routes (representative) |
|-------|-------------------------|
| Account / market | `/api/account`, `/api/market`, `/api/market/clock` |
| AI | `/api/ai/decision`, `/history`, `/health`, `/command`, `/tasks` |
| News | `/api/news` |
| Performance | `/api/performance`, `/api/backtest` |
| Trades | `/api/trades`, `/preview`, `/submit-paper` |
| Monitor | `/api/monitor`, `/start`, `/stop`, `/scan`, `/stream` (SSE), `/logs`, `/opportunities` |
| Auto-trade | `/api/auto-trade`, enable/disable, execution, kill/panic/emergency, pause/resume, close-all, settings, analytics, session-report, logs |
| Stocks / settings / safety | `/api/stocks/candidates`, `/lookup`, `/api/settings`, `/api/safety` |

### Integrations

| Integration | Role | Status |
|-------------|------|--------|
| **Alpaca Paper Trading API** | Account, orders, positions, clock | **Code** — paper only |
| **Alpaca Market Data API** | Quotes + bars (IEX) | **Code** — REST only |
| **Finnhub** | Company news | **Code**; `.env.local` `NEWS_PROVIDER=finnhub` |
| **Ollama** | Local LLM for news/explanations | **Code**; `.env.local` `AI_PROVIDER=ollama` |

### Local file store (observed under `data/`)

`auto-trade-settings.json`, `decision-history.jsonl` (135 lines), `monitor-logs.jsonl`, `paper-session.json`, `reconcile-state.json`, `risk-runtime.json`, `universe-snapshot.json`, `session-report-latest.json`, `session-reports/2026-07-11.json`.

Missing (expected when auto path runs more): `signal-training.jsonl`, `decision-log.jsonl`, various auto-trade JSONL logs.

---

## 7. Alpaca paper-trading integration status

| Capability | Status | Evidence |
|------------|--------|----------|
| Paper base URL enforced | **Done** | **Code** `alpaca/safety.ts`; `.env.local` = `https://paper-api.alpaca.markets` |
| Live host blocked | **Done** | **Code** + **Tests** multiple verifies |
| Account / positions / clock / orders read | **Done** | **Code** client |
| Place paper orders | **Implemented, gated OFF** | Requires execution enabled; `.env.local` `ENABLE_PAPER_ORDER_EXECUTION=false`; runtime `executionEnabled: false` |
| Bracket auto entries | **Done in code** | **Code** + **Tests** `verify:brackets` PASS |
| Close position / close all | **Done** | **Code** APIs + UI |
| Paper keys present locally | **Configured** | **Code** env present (values redacted) |
| End-to-end soak of auto fills | **Not verified** | Session report shows odd accepted SELL qty 0; unprotected AAPL; soak checklist empty |

**Current runtime (2026-07-11 artifacts):** 1 open AAPL fractional position (~2.16 shares), 1 open order, reconciliation complete, **unprotected** (no SL/TP), unrealized PnL ≈ +$2.97. Auto/execution both **false**.

---

## 8. Real-time and historical market-data status

| Kind | Status | Evidence |
|------|--------|----------|
| Latest quotes (REST, IEX) | **Working path** | **Code** `getLatestQuotes` + ~25s cache |
| Latest / recent bars (REST, IEX) | **Working path** | **Code** used for technicals + outcomes |
| Historical bars for backtest/outcomes | **Working path** | **Code** performance/backtest/training |
| Market clock | **Working path** | **Code** paper `/v2/clock` |
| App “live” UX | **SSE for monitor status only** | **Code** `/api/monitor/stream` — **not** tick streaming |
| WebSocket market stream | **Not implemented** | No `wss` / stream client in `src/` |
| Persistent bar warehouse | **Not implemented** | No DB |

---

## 9. Auto-trading workflow (signal → order)

**Verified from code** (end-to-end path exists; execution currently off):

```
instrumentation.register()
  → loadRuntimeSettings()
  → ensureMonitorWorkerRunning()
      → reconcileTradingState()
      → startMonitor() / interval scans
          → resolveEligibleUniverse()
          → clock + cached quotes + multi-TF bars + news + market condition
          → generateWatchlistDecisions()   # heuristic scores
          → decisionsToOpportunities()
          → processAutoTradesForScan()
              → evaluateAutoTradeEligibility()
              → BUY: buildLongProposal() → evaluateRiskProposal()
                    → submitRiskApprovedEntry() → placePaperOrder(bracket SL/TP)
              → SELL (if allowSellAuto): market close full qty
```

**Gates before any order:** paper URL, `executionEnabled`, `autoTradingEnabled`, kill/panic/runtimeDisabled, confidence, market hours/quality, daily limits, cooldowns, duplicates, risk engine, universe eligibility.

**Monitor never places orders directly** — **Tests** `verify:phase7` / `phase8` PASS.

---

## 10. Current risk controls, stop-loss, take-profit, daily limits, and safety blocks

### Implemented (**Code** + mostly **Tests**)

| Control | Default / notes |
|---------|-----------------|
| Stop-loss | `defaultStopLossPct` **1.5%** (auto BUY brackets) |
| Take-profit | `defaultTakeProfitPct` **3%** |
| Max open positions | **3** (soak → 1) |
| Max trades / day | **3** runtime (phase6 verify still expects env default 5 — drift) |
| Max risk / trade | **0.5%** equity (soak → 0.25%) |
| Max position allocation | **10%** (soak → 5%) |
| Max daily loss % | **2%** (soak → 1%) |
| Max daily loss $ | `MAX_DAILY_PAPER_LOSS` default **$10** (eligibility) |
| Consecutive loss pause | **3** |
| Long only / RTH only | **true** (shorting cannot be enabled) |
| Open delay / EOD cutoff | 0 / 30 min (soak 15 / 45) |
| Cooldown | **30** minutes |
| Min confidence | **0.75** |
| Kill switch | Blocks new auto activity |
| Panic / Emergency Stop | Disables execution/auto, cancels pending entries, **keeps positions** |
| Close All | Separate, confirmation-protected flatten |
| Universe filters | $5–$50, volume, spread, no leveraged/inverse ETFs |
| Live trading | Always `liveTradingAllowed: false` |

### Gaps

- Manual submits: **no brackets**
- Orphan unprotected positions: **detected, not healed**
- No trailing stops / sector limits

---

## 11. AI / strategy-training progress

| Layer | Status | Evidence |
|-------|--------|----------|
| Trade decisions | **Heuristic rule/score engine** (`scoring.ts`, `technicals.ts`, `decision.ts`) | **Code** |
| News AI | Heuristic or Ollama; fallback | **Code**; env ollama |
| Trade reasoning text | Ollama explain allow/block (never orders) | **Code** + **Tests** |
| Strategy version | Static `v1.0.0` weights | **Code** |
| Signal training JSONL | Code ready | **Not started in runtime** (file absent) |
| Model training / weight learning | **Not implemented** | No ML stack |
| Historical decisions on disk | 135 records, **all HOLD**, outcomes present | `data/decision-history.jsonl` |

**Conclusion:** “AI strategy” is a **versioned heuristic**; training is **logging only**. No trained model.

---

## 12. Tests completed and their latest results

**Ran this session (2026-07-15)** — 27 verify scripts:

### PASS (24)

`phase1`, `phase2`, `phase2.5`, `phase3`, `phase3.5`, `phase4`, `phase5`, `phase6.5`, `phase7`, `phase8`, `phase9`, `phase10`, `phases-9-15`, `paper-blocks`, `ai-command`, `auto-trade-clarity`, `universe`, `risk-engine`, `brackets`, `paper-soak`, `runtime-settings`, `auto-trade-modals`, `small-account`

### FAIL (3)

| Script | Cause (this session) |
|--------|----------------------|
| `verify:phase6` | Asserts `getMaxDailyPaperTrades() === 5`; current default is **3** |
| `verify:auto-trade-risk` | Looks for exact string `"Close all positions"` in `AutoTradePageView`; UI uses `"Close All Positions"` / other casing |
| `verify:auto-trade-controls` | Asserts file must **not** contain `"window.confirm"`, but a **comment** mentions `window.confirm` |

These are **brittle/stale test assertions**, not proof the features are missing. Feature code for controls/risk/modals exists; `verify:auto-trade-modals` and `verify:runtime-settings` PASS.

**Not run this session:** full `npm run build` / live Alpaca integration smoke against market hours (verify scripts are mostly offline/unit).

**No Jest/Vitest/Playwright suite** — verification is custom `tsx` scripts only.

---

## 13. Known bugs, technical debt, missing pieces, and blockers

### Known issues (verified)

1. **Universe eligible count = 0** for current watchlist `AAPL,MSFT,GOOGL,AMZN,NVDA` under $5–$50 filter — auto scanner will not trade (**Code** + `data/universe-snapshot.json`).
2. **Unprotected AAPL paper position** left from 2026-07-11 session (**data**).
3. **Three verify scripts failing** due to assertion drift (**Tests**).
4. **README outdated** — understates auto-trade/monitor/risk (**Docs** vs **Code**).
5. **`.env.example` contains credential-like values** — treat as compromised if ever real; rotate Alpaca/Finnhub keys (**Docs**/repo hygiene).
6. **Dead UI components** (`AiCommandCenter`, `DashboardSummary`) — debt.
7. **Training loop never populated** — no learning data yet.
8. **Paper soak checklist not executed** — auto path not operationally proven.

### Blockers for useful auto paper trading

- Execution + auto flags still off (correct for safety, but blocks validation)
- Watchlist incompatible with universe price band (or enable soak profile / mid-price list)
- Need market hours + broker acceptance soak scenarios

### Blockers for live trading

- **Intentional hard blocks everywhere** — by design; no unlock flag exists

---

## 14. What is currently safe to test

**Safe now (execution off):**

- Dashboard / Watchlist / Monitor (scan without orders)
- Performance, Backtest, Logs, Settings (read/local prefs)
- AI Assistant questions (no order submit)
- Safety / provider status endpoints
- Running verify scripts (offline)
- Previewing manual paper trades (**preview only**)

**Safe with care (explicit opt-in):**

- Set `ENABLE_PAPER_ORDER_EXECUTION=true` **or** runtime Execution ON → **manual** paper submits only, small notional, confirm checkbox
- Keep `AUTO_PAPER_TRADING_ENABLED` / Auto Trading OFF until soak watchlist fixed

**Recommended next paper test:**

1. Fix universe (enable `PAPER_SOAK_PROFILE` or mid-price watchlist)
2. Run `npm run verify:paper-soak`
3. Follow `docs/PAPER-SOAK-TEST-CHECKLIST.md` with tiny size limits
4. Confirm Emergency Stop ≠ Close All

---

## 15. What is still blocked from live trading

**Everything live is blocked.** Specifically:

- `assertPaperTradingOnly` rejects `api.alpaca.markets` and non-paper hosts
- Runtime settings force `liveTradingAllowed: false` / `paperOnly: true`
- No env flag enables live trading
- UI banners and APIs advertise paper-only
- Even with paper execution ON, orders only go to paper-api

**Also not ready for unsupervised paper auto:**

- Soak not completed
- Universe empty on mega-caps
- Unprotected open position needs manual handling
- Training/analytics loop not yet producing strategy iteration

---

## 16. Next recommended milestones (priority order)

1. **Fix verify drift** — update `verify:phase6`, `verify:auto-trade-risk`, `verify:auto-trade-controls` to match current defaults/UI (restore green suite).
2. **Resolve unprotected AAPL** — manually protect or close on paper; confirm Emergency Stop / Close All behavior.
3. **Make universe tradable** — enable `PAPER_SOAK_PROFILE` or replace watchlist with mid-price liquid names; confirm Auto Trade → Universe eligible count > 0.
4. **Update README** — document Phases 6–15, runtime settings, dual gates (execution + auto), soak profile.
5. **Controlled paper soak** — execute checklist scenarios 1–10 with tiny risk; capture session reports.
6. **Rotate secrets if `.env.example` ever held real keys**; scrub example file to placeholders only.
7. **Exercise training loop** — generate `signal-training.jsonl` during soak; review analytics.
8. **Only after soak pass:** consider longer paper auto run (still paper-only).
9. **Do not plan live trading** until multi-week paper performance + explicit product decision (currently out of scope by design).
10. **Optional later:** WebSocket quotes, DB persistence, true ML from training data, trailing stops, orphan auto-repair.

---

## Overall completion percentages (honest)

| Area | % | Notes |
|------|---|-------|
| **Frontend** | **88%** | Full desk pages polished; Assistant page thin; unused components; Settings local-only |
| **Backend** | **90%** | Rich API + file persistence; no DB; README lag |
| **Paper trading** | **75%** | Read + gated write paths solid; limited real fill evidence; unprotected position |
| **Auto trading** | **70%** | Pipeline complete in code/tests; runtime off; universe empty; soak not done → operational ~40% |
| **Risk management** | **85%** | Strong gates/brackets/emergency; manual path lacks brackets; no orphan heal |
| **AI strategy** | **45%** | Heuristic v1 + explain/news AI done; **no trained model**; training log unused |
| **Testing** | **80%** | Broad verify coverage; 24/27 green; no E2E browser/broker soak automation |
| **Live-trading readiness** | **0%** | Intentionally blocked; not a near-term goal |

### Aggregate (weighted judgment)

**~72% of the paper-trading assistant product is built.**  
**~35% of unsupervised auto paper trading is operationally proven.**  
**0% live-trading ready.**

---

## Evidence index (this review)

| Source | Used for |
|--------|----------|
| `git log` / `43c666f` | Commit history / scope |
| `src/**` | Implementation truth |
| `docs/PHASES-9-15-MASTER-PLAN.md`, `PAPER-SOAK-TEST-CHECKLIST.md`, `README.md` | Planned vs documented |
| `package.json` scripts | Verify inventory |
| `npm run verify:*` (this session) | Test results |
| `data/*` | Runtime/session evidence |
| `.env.local` (flags only) | Current operator config |
| Agent transcripts | Context only; not treated as source of truth |

---

*End of report. Saved for handoff continuity. Re-run verify scripts and refresh `data/` artifacts after the next soak before treating auto-trade as production-ready paper.*
