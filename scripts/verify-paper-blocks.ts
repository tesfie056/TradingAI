/**
 * Paper trade block explanation verification.
 * Run: npm run verify:paper-blocks
 */
import assert from "node:assert/strict";
import { evaluateOrderGates } from "../src/lib/trades/gates";
import {
  buildTradeEligibilityChecklist,
  collectUiBlockExplanations,
  primarySubmitStatus,
  splitPrimarySecondaryExplanations,
  submitButtonState,
} from "../src/lib/trades/block-explanations";
import type { DataQuality } from "../src/lib/alpaca/types";
import { isPaperOrderExecutionEnabled } from "../src/lib/config";

const goodDq: DataQuality = {
  isMarketOpen: true,
  isQuoteStale: false,
  spreadPercent: 0.001,
  hasRecentBars: true,
  warningMessages: [],
};

function main() {
  console.log("verify:paper-blocks starting…");
  assert.equal(isPaperOrderExecutionEnabled(), false);

  const closed = evaluateOrderGates({
    executionEnabled: true,
    paperEndpointOk: true,
    action: "BUY",
    side: "buy",
    riskStatus: "low",
    dataQuality: { ...goodDq, isMarketOpen: false },
    qty: 1,
    estimatedPrice: 100,
    maxNotional: 500,
    dailyTradeCount: 0,
    maxDailyTrades: 5,
  });
  const closedUi = collectUiBlockExplanations({
    blockers: closed.blockers,
    approved: true,
  });
  assert.ok(closedUi.some((e) => e.code === "market_closed"));
  assert.match(closedUi.find((e) => e.code === "market_closed")!.detail, /market hours/i);
  assert.equal(primarySubmitStatus(closedUi).label, "Trade Blocked");
  assert.equal(
    primarySubmitStatus(closedUi).kind === "blocked"
      ? primarySubmitStatus(closedUi).primaryReason
      : "",
    "Market closed",
  );
  assert.equal(
    submitButtonState({
      explanations: closedUi,
      tradeBusy: false,
      canSubmitGates: false,
      approved: true,
      executionEnabled: true,
    }).label,
    "Cannot submit — market closed",
  );
  console.log("✓ market closed");

  const closedPlusData = evaluateOrderGates({
    executionEnabled: true,
    paperEndpointOk: true,
    action: "BUY",
    side: "buy",
    riskStatus: "high",
    dataQuality: {
      ...goodDq,
      isMarketOpen: false,
      isQuoteStale: true,
      spreadPercent: 0.05,
    },
    qty: 1,
    estimatedPrice: 100,
    maxNotional: 500,
    dailyTradeCount: 0,
    maxDailyTrades: 5,
  });
  const closedPlusUi = collectUiBlockExplanations({
    blockers: closedPlusData.blockers,
    approved: true,
  });
  const split = splitPrimarySecondaryExplanations(closedPlusUi);
  assert.equal(split.primary?.code, "market_closed");
  assert.ok(split.secondary.some((e) => e.code === "stale_quote"));
  assert.ok(split.secondary.some((e) => e.code === "wide_spread"));
  assert.ok(split.marketClosedNote);
  assert.match(split.marketClosedNote!, /when the market opens/i);
  const checklist = buildTradeEligibilityChecklist({
    blockers: closedPlusData.blockers,
    approved: false,
  });
  assert.equal(checklist.find((c) => c.id === "market_open")?.pass, false);
  assert.equal(checklist.find((c) => c.id === "fresh_quote")?.pass, false);
  assert.equal(checklist.find((c) => c.id === "spread_ok")?.pass, false);
  assert.equal(checklist.find((c) => c.id === "risk_ok")?.pass, false);
  assert.equal(checklist.find((c) => c.id === "confirmation")?.pass, false);
  console.log("✓ market closed primary + secondary effects");
  console.log("✓ eligibility checklist pass/fail");

  const stale = evaluateOrderGates({
    executionEnabled: true,
    paperEndpointOk: true,
    action: "BUY",
    side: "buy",
    riskStatus: "low",
    dataQuality: { ...goodDq, isQuoteStale: true },
    qty: 1,
    estimatedPrice: 100,
    maxNotional: 500,
    dailyTradeCount: 0,
    maxDailyTrades: 5,
  });
  const staleUi = collectUiBlockExplanations({
    blockers: stale.blockers,
    approved: true,
  });
  assert.ok(staleUi.some((e) => e.code === "stale_quote"));
  assert.equal(primarySubmitStatus(staleUi).label, "Trade Blocked");
  assert.equal(
    primarySubmitStatus(staleUi).kind === "blocked"
      ? primarySubmitStatus(staleUi).primaryReason
      : "",
    "Stale quote",
  );
  assert.equal(
    submitButtonState({
      explanations: staleUi,
      tradeBusy: false,
      canSubmitGates: false,
      approved: true,
      executionEnabled: true,
    }).label,
    "Cannot submit — quote stale",
  );
  console.log("✓ stale quote");

  const wide = evaluateOrderGates({
    executionEnabled: true,
    paperEndpointOk: true,
    action: "BUY",
    side: "buy",
    riskStatus: "low",
    dataQuality: { ...goodDq, spreadPercent: 0.05 },
    qty: 1,
    estimatedPrice: 100,
    maxNotional: 500,
    dailyTradeCount: 0,
    maxDailyTrades: 5,
  });
  const wideUi = collectUiBlockExplanations({
    blockers: wide.blockers,
    approved: true,
  });
  assert.ok(wideUi.some((e) => e.code === "wide_spread"));
  assert.equal(primarySubmitStatus(wideUi).label, "Trade Blocked");
  assert.equal(
    primarySubmitStatus(wideUi).kind === "blocked"
      ? primarySubmitStatus(wideUi).primaryReason
      : "",
    "Wide spread",
  );
  assert.equal(
    submitButtonState({
      explanations: wideUi,
      tradeBusy: false,
      canSubmitGates: false,
      approved: true,
      executionEnabled: true,
    }).label,
    "Cannot submit — wide spread",
  );
  console.log("✓ wide spread");

  const risk = evaluateOrderGates({
    executionEnabled: true,
    paperEndpointOk: true,
    action: "BUY",
    side: "buy",
    riskStatus: "high",
    dataQuality: goodDq,
    qty: 1,
    estimatedPrice: 100,
    maxNotional: 500,
    dailyTradeCount: 0,
    maxDailyTrades: 5,
  });
  const riskUi = collectUiBlockExplanations({
    blockers: risk.blockers,
    approved: true,
  });
  assert.ok(riskUi.some((e) => e.code === "high_risk"));
  assert.equal(primarySubmitStatus(riskUi).label, "Trade Blocked");
  assert.equal(
    primarySubmitStatus(riskUi).kind === "blocked"
      ? primarySubmitStatus(riskUi).primaryReason
      : "",
    "High risk",
  );
  assert.equal(
    submitButtonState({
      explanations: riskUi,
      tradeBusy: false,
      canSubmitGates: false,
      approved: true,
      executionEnabled: true,
    }).label,
    "Cannot submit — high risk",
  );
  console.log("✓ high risk");

  const execOff = evaluateOrderGates({
    executionEnabled: false,
    paperEndpointOk: true,
    action: "BUY",
    side: "buy",
    riskStatus: "low",
    dataQuality: goodDq,
    qty: 1,
    estimatedPrice: 100,
    maxNotional: 500,
    dailyTradeCount: 0,
    maxDailyTrades: 5,
  });
  const execUi = collectUiBlockExplanations({
    blockers: execOff.blockers,
    approved: true,
  });
  assert.ok(execUi.some((e) => e.code === "execution_disabled"));
  assert.equal(primarySubmitStatus(execUi).label, "Trade Blocked");
  assert.equal(
    primarySubmitStatus(execUi).kind === "blocked"
      ? primarySubmitStatus(execUi).primaryReason
      : "",
    "Execution off",
  );
  assert.equal(
    submitButtonState({
      explanations: execUi,
      tradeBusy: false,
      canSubmitGates: false,
      approved: true,
      executionEnabled: false,
    }).label,
    "Cannot submit — execution off",
  );
  console.log("✓ execution off");

  const confirmUi = collectUiBlockExplanations({
    blockers: [],
    approved: false,
  });
  assert.ok(confirmUi.some((e) => e.code === "missing_confirmation"));
  assert.equal(primarySubmitStatus(confirmUi).label, "Trade Blocked");
  assert.equal(
    primarySubmitStatus(confirmUi).kind === "blocked"
      ? primarySubmitStatus(confirmUi).primaryReason
      : "",
    "Confirmation required",
  );
  assert.equal(
    submitButtonState({
      explanations: confirmUi,
      tradeBusy: false,
      canSubmitGates: true,
      approved: false,
      executionEnabled: true,
    }).label,
    "Cannot submit — check confirmation box",
  );
  console.log("✓ confirmation required");

  const readyUi = collectUiBlockExplanations({
    blockers: [],
    approved: true,
  });
  assert.equal(readyUi.length, 0);
  assert.equal(primarySubmitStatus(readyUi).label, "Trade Eligible");
  const readyBtn = submitButtonState({
    explanations: readyUi,
    tradeBusy: false,
    canSubmitGates: true,
    approved: true,
    executionEnabled: true,
  });
  assert.equal(readyBtn.disabled, false);
  assert.equal(readyBtn.label, "Confirm & submit paper order");
  console.log("✓ submit enables when all checks pass");

  console.log("verify:paper-blocks passed");
}

main();
