/**
 * Phase B — risk engine unit tests.
 * Run: npx tsx scripts/verify-risk-engine.ts
 */
import assert from "node:assert/strict";
import { evaluateRiskProposal } from "../src/lib/risk/engine";
import { sizePosition } from "../src/lib/risk/sizing";
import type { RiskRuntimeState } from "../src/lib/risk/runtime";

function runtime(overrides: Partial<RiskRuntimeState> = {}): RiskRuntimeState {
  return {
    paperOnly: true,
    dayKey: "2026-07-10",
    consecutiveLosses: 0,
    consecutiveWins: 0,
    dailyRealizedPnL: 0,
    dailyUnrealizedPnL: 0,
    entriesPaused: false,
    pauseReason: null,
    lastReconciledAt: new Date().toISOString(),
    reconciliationComplete: true,
    ...overrides,
  };
}

function base(
  overrides: Partial<Parameters<typeof evaluateRiskProposal>[0]> = {},
) {
  return {
    symbol: "AAPL",
    direction: "long" as const,
    entryPrice: 20,
    stopLossPrice: 19.7,
    takeProfitPrice: 20.6,
    confidence: 0.8,
    equity: 10_000,
    openPositionCount: 0,
    openSymbols: [] as string[],
    pendingEntrySymbols: [] as string[],
    marketOpen: true,
    minutesToClose: 120,
    minutesSinceOpen: 60,
    riskRuntime: runtime(),
    reconciliationComplete: true,
    maxNotionalCap: 500,
    ...overrides,
  };
}

function main() {
  console.log("verify:risk-engine starting…");

  const sized = sizePosition({
    equity: 10_000,
    entryPrice: 20,
    stopLossPrice: 19.7,
  });
  assert.ok(sized.qty > 0);
  assert.ok(sized.notional <= 10_000 * 0.1 + 0.01);
  assert.ok(sized.riskAmount <= 10_000 * 0.005 + 0.01);
  console.log("✓ position sizing respects risk and allocation caps");

  const ok = evaluateRiskProposal(base());
  assert.equal(ok.approved, true);
  assert.ok(ok.qty > 0);
  console.log("✓ valid proposal approved");

  const maxPos = evaluateRiskProposal(
    base({ openPositionCount: 3, openSymbols: ["X", "Y", "Z"] }),
  );
  assert.equal(maxPos.approved, false);
  assert.equal(maxPos.code, "max_open_positions");
  console.log("✓ max open positions enforced");

  const dup = evaluateRiskProposal(
    base({ openSymbols: ["AAPL"], openPositionCount: 1 }),
  );
  assert.equal(dup.approved, false);
  assert.equal(dup.code, "duplicate_position");
  console.log("✓ duplicate position blocked");

  const pending = evaluateRiskProposal(
    base({ pendingEntrySymbols: ["AAPL"] }),
  );
  assert.equal(pending.approved, false);
  assert.equal(pending.code, "pending_entry");
  console.log("✓ pending entry blocked");

  const daily = evaluateRiskProposal(
    base({
      riskRuntime: runtime({
        dailyRealizedPnL: -150,
        dailyUnrealizedPnL: -60,
      }),
    }),
  );
  assert.equal(daily.approved, false);
  assert.equal(daily.code, "daily_loss_limit");
  console.log("✓ daily loss limit enforced");

  const streak = evaluateRiskProposal(
    base({ riskRuntime: runtime({ consecutiveLosses: 3 }) }),
  );
  assert.equal(streak.approved, false);
  assert.equal(streak.code, "consecutive_losses");
  console.log("✓ consecutive-loss pause enforced");

  const closed = evaluateRiskProposal(base({ marketOpen: false }));
  assert.equal(closed.approved, false);
  assert.equal(closed.code, "market_closed");
  console.log("✓ market-hours enforcement");

  const eod = evaluateRiskProposal(base({ minutesToClose: 15 }));
  assert.equal(eod.approved, false);
  assert.equal(eod.code, "eod_cutoff");
  console.log("✓ end-of-day entry cutoff");

  // Open-delay only applies when config delay > 0 (soak profile / env).
  process.env.RISK_OPEN_ENTRY_DELAY_MINUTES = "15";
  const openDelay = evaluateRiskProposal(base({ minutesSinceOpen: 5 }));
  assert.equal(openDelay.approved, false);
  assert.equal(openDelay.code, "open_delay");
  delete process.env.RISK_OPEN_ENTRY_DELAY_MINUTES;
  console.log("✓ open-entry delay enforced");

  const recon = evaluateRiskProposal(base({ reconciliationComplete: false }));
  assert.equal(recon.approved, false);
  assert.equal(recon.code, "reconciliation_pending");
  console.log("✓ blocks until reconciliation complete");

  console.log("verify:risk-engine passed");
}

main();
