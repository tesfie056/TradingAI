# Paper soak test checklist (Phase H)

Controlled paper-only validation. **Do not enable live trading.**  
Emergency Stop must **not** close open positions. Close All stays separate and confirmation-protected.

## Preflight (before soak)

- [ ] `PAPER_SOAK_PROFILE=true` in `.env.local`
- [ ] `ALPACA_BASE_URL` points at paper API only
- [ ] `AUTO_PAPER_TRADING_ENABLED=true` and `ENABLE_PAPER_ORDER_EXECUTION=true` (paper only)
- [ ] `ALLOW_SELL_AUTO=false` (long-only soak)
- [ ] Confirm strategy version on Auto Trade page / status API
- [ ] Confirm watchlist / universe filters (soak uses `PAPER_SOAK_WATCHLIST` / mid-price default, not mega-caps)
- [ ] Auto Trade → **Universe** shows eligible count > 0 (or clear warnings if not)
- [ ] Confirm scan interval (open ~90s / closed ~15m unless overridden)
- [ ] Run `npm run verify:paper-soak`

## Controlled scenarios

| # | Scenario | Pass criteria |
|---|----------|---------------|
| 1 | Normal entry and bracket order | BUY submits `order_class: bracket` with stop-loss + take-profit; qty sized by risk engine |
| 2 | Duplicate proposal rejection | Second entry for same open/pending symbol rejected (`duplicate_position` or `pending_entry`) |
| 3 | Maximum trade count enforcement | After 2 new trades today, further entries blocked (`max_daily_trades`) |
| 4 | Daily loss-limit enforcement | When realized+unrealized ≤ −1% equity, new entries blocked (`daily_loss_limit`) |
| 5 | Emergency Stop with an open position | Panic ON; pending entries canceled; **position remains open**; UI shows preserved note |
| 6 | Canceling pending entries | Emergency Stop cancels open entry orders without flattening positions |
| 7 | Backend restart with an open position | Reconcile completes; position visible; no duplicate entry until rules allow |
| 8 | Backend restart with a pending order | Reconcile sees pending order; duplicate entry blocked; entries gated until reconcile done |
| 9 | Broker order rejection | Decision log `rejected_broker`; no silent retry loop; dashboard shows rejected proposals |
| 10 | Missing or failed protective order | Orphan / unprotected position flagged in reconcile + session report safety warnings |

## After each scenario

- [ ] Review Auto Trade → **Paper Test Results**
- [ ] Open `data/session-report-latest.json` (or `data/session-reports/YYYY-MM-DD.json`)
- [ ] Confirm `data/decision-log.jsonl` has approve/reject reasons
- [ ] Confirm Emergency Stop ≠ Close All

## Soak run notes

Date: ________  
Operator: ________  
Pass / Fail: ________  
Issues: ________
