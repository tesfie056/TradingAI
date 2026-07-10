/**
 * Phase C — bracket orders + proposal helpers.
 * Run: npx tsx scripts/verify-brackets.ts
 */
import assert from "node:assert/strict";
import { buildAlpacaOrderBody } from "../src/lib/alpaca/client";
import { buildBracketOrderBody } from "../src/lib/trading/brackets";
import { buildLongProposal } from "../src/lib/trading/proposal";

function main() {
  console.log("verify:brackets starting…");

  const proposal = buildLongProposal({
    symbol: "AAPL",
    entry: 20,
    stopLossPct: 1.5,
    takeProfitPct: 3,
    confidence: 0.8,
    strategyName: "test",
    reason: "unit test",
  });
  assert.ok(proposal.stopLoss < proposal.proposedEntry);
  assert.ok(proposal.takeProfit > proposal.proposedEntry);
  assert.equal(proposal.paperOnly, true);
  console.log("✓ long proposal has SL below and TP above entry");

  const body = buildBracketOrderBody({
    symbol: "AAPL",
    qty: 1.5,
    side: "buy",
    takeProfitLimitPrice: proposal.takeProfit,
    stopLossStopPrice: proposal.stopLoss,
  });
  assert.equal(body.order_class, "bracket");
  assert.equal(body.qty, "1.5");
  assert.ok(body.take_profit.limit_price);
  assert.ok(body.stop_loss.stop_price);
  assert.equal((body as { notional?: string }).notional, undefined);
  console.log("✓ bracket body uses qty + SL/TP, no notional");

  const viaClient = buildAlpacaOrderBody({
    symbol: "MSFT",
    qty: 2,
    side: "buy",
    order_class: "bracket",
    take_profit: { limit_price: 110 },
    stop_loss: { stop_price: 95 },
  });
  assert.equal(viaClient.order_class, "bracket");
  assert.equal(viaClient.qty, "2");
  console.log("✓ buildAlpacaOrderBody supports brackets");

  assert.throws(() =>
    buildBracketOrderBody({
      symbol: "X",
      qty: 1,
      side: "buy",
      takeProfitLimitPrice: 10,
      stopLossStopPrice: 12,
    }),
  );
  console.log("✓ invalid long bracket rejected");

  console.log("verify:brackets passed");
}

main();
